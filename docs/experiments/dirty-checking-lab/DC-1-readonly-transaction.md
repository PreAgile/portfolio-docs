# DC-1. `@Transactional(readOnly = true)` 효과 측정

> **Lab**: Dirty Checking Lab | **Phase**: 1 (가장 쉬움) | **선행 이슈**: #4 완료 후
> **핵심**: "읽기 전용 트랜잭션이 실제로 운영에서 어떤 리소스 차이를 만드는가"

---

## 📌 실무에서 발생하는 문제

### 증상
- 서비스 레이어 전체에 `@Transactional` 또는 클래스 단위로 선언
- 읽기 전용 조회 API도 전부 read-write 트랜잭션으로 동작
- DB 커넥션 점유 시간 증가 + JPA 스냅샷 비용 누적 + GC 부하

### 왜 주니어 시절에 쉽게 놓치는가
- `@Transactional`은 "트랜잭션만 열어준다" 정도로만 이해
- `readOnly=true`의 실제 효과를 체감하지 못함
- 성능 측정 없이 "일단 붙이면 안전하다" 문화

### 운영 환경에서 관찰 가능한 증거
- MySQL `performance_schema`에서 **`SET SESSION TRANSACTION READ ONLY / READ WRITE`** 같은 세션 옵션 쿼리 폭증
- JVM heap이 스냅샷 Object[]로 빠르게 차오름
- Young GC 빈도 증가 → P99 튐

---

## 🏢 연결된 공개 사례

### 1. 카카오페이 — "JPA Transactional 잘 알고 쓰고 계신가요?"

**원문**: https://tech.kakaopay.com/post/jpa-transactional-bri/

**요약**:
- 온라인 결제 서비스 운영 중 MySQL 쿼리 분석
- **`set_option` 쿼리가 약 14,000건** 발견 (세션 설정 변경)
- 원인: 클래스 단위 `@Transactional` 남발 + 기본 isolation 변경
- 해결:
  1. 클래스 단위 `@Transactional` 제거
  2. 읽기 메서드에 `@Transactional(readOnly = true)` 명시
  3. 쓰기 메서드에만 선택적 `@Transactional`
- 결과: 불필요한 세션 옵션 쿼리 제거, DB 리소스 사용 감소

### 2. Vlad Mihalcea — "Spring read-only transaction Hibernate optimization"

**원문**: https://vladmihalcea.com/spring-read-only-transaction-hibernate-optimization/

**핵심 요지**:
- `readOnly=true`는 Hibernate에 **"hydrated state를 폐기하라"** 신호 전달
- 스냅샷(loadedState) 생성 자체를 생략 → 메모리 절약
- JDBC 커넥션에도 `setReadOnly(true)` 호출 → MySQL에서 **read-only 트랜잭션 최적화** 활성화
- 메모리 + DB 엔진 양쪽에서 이득

### 3. HikariCP 최적화 (블로그/이슈 참조)
- HikariCP 2.4.1부터 `setReadOnly(true)` 호출 오버헤드 감소
- MySQL 드라이버 옵션 `useLocalSessionState=true`와 조합 시 RTT 추가 감소

---

## 💼 본인 실무와의 연결점

### 관찰된 패턴

```
(가설적 운영 상황)
- 리뷰 조회 API, 댓글 목록 API, 통계 대시보드 API 등 조회 엔드포인트 다수
- 이들 대부분이 서비스 레이어에 @Transactional (readOnly 명시 없음)
- 또는 Service 클래스 단위 @Transactional(readOnly = false, propagation = REQUIRED)
```

### 파급 효과
1. **JPA 스냅샷 생성**: 조회만 해도 엔티티마다 loadedState 복제 (메모리 낭비)
2. **flush 호출**: 트랜잭션 종료 시 굳이 dirty check 수행 (CPU 낭비)
3. **DB 세션 옵션**: JDBC가 매 트랜잭션마다 read-write 설정 송수신

### 이 실험이 답하려는 질문
1. readOnly 적용 시 **실측으로** 얼마나 차이 나는가?
2. 트래픽 수준에 따라 효과가 달라지는가?
3. 카카오페이의 `set_option` 감소를 내 환경에서도 재현 가능한가?

---

## 🎯 가설

1. **H1 (메모리)**: readOnly 트랜잭션은 일반 대비 엔티티 1개당 `Object[] loadedState` 할당을 생략해 힙 증가 속도가 느리다.
2. **H2 (DB 쿼리)**: JDBC `setReadOnly(true)` 호출로 MySQL 세션 옵션 쿼리가 감소한다.
3. **H3 (지연)**: flush 호출 자체가 생략되어 p99 응답 시간이 소폭 감소한다.
4. **H4 (트레이드오프)**: 대신 `setReadOnly(true)` 호출 자체가 드라이버 버전/설정에 따라 오버헤드가 될 수 있다.

---

## 🔧 구현 방법

### 코드 변경

```java
@Service
public class ReplyQueryService {

    // === Case A: 대조군 (기본 트랜잭션) ===
    @Transactional
    public ReplyRequestDto getReplyDefault(Long id) {
        ReplyRequest entity = replyRepo.findById(id).orElseThrow();
        return ReplyRequestDto.from(entity);
    }

    // === Case B: 실험군 (readOnly) ===
    @Transactional(readOnly = true)
    public ReplyRequestDto getReplyReadOnly(Long id) {
        ReplyRequest entity = replyRepo.findById(id).orElseThrow();
        return ReplyRequestDto.from(entity);
    }
}
```

**API 엔드포인트**:
```java
@GetMapping("/api/dc1/reply/{id}")
public ReplyRequestDto reply(@PathVariable Long id,
                              @RequestParam(defaultValue = "default") String mode) {
    return switch (mode) {
        case "readonly" -> queryService.getReplyReadOnly(id);
        default -> queryService.getReplyDefault(id);
    };
}
```

### application.yml 설정
```yaml
spring:
  jpa:
    properties:
      hibernate:
        generate_statistics: true
        use_sql_comments: true
  datasource:
    hikari:
      auto-commit: false   # readOnly 효과 명확화
      data-source-properties:
        useLocalSessionState: true
        useLocalTransactionState: true
```

### k6 시나리오

```javascript
// docker/k6/dc1-readonly.js
import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  scenarios: {
    default_tx: {
      executor: 'constant-vus', vus: 50, duration: '1m',
      exec: 'defaultTx',
      tags: { mode: 'default' },
    },
    readonly_tx: {
      executor: 'constant-vus', vus: 50, duration: '1m', startTime: '1m30s',
      exec: 'readOnlyTx',
      tags: { mode: 'readonly' },
    },
  },
};

export function defaultTx() {
  http.get('http://host.docker.internal:8080/api/dc1/reply/1?mode=default');
  sleep(0.05);
}
export function readOnlyTx() {
  http.get('http://host.docker.internal:8080/api/dc1/reply/1?mode=readonly');
  sleep(0.05);
}
```

---

## 📊 측정 메트릭

| 축 | 메트릭 | 수단 |
|----|--------|------|
| **DB 레벨** | 세션 옵션 쿼리 수 | `SHOW STATUS LIKE 'Com_set_option'` |
| **JDBC 레벨** | `setReadOnly` 호출 수 | p6spy 로그 |
| **Hibernate 레벨** | `flush()` 호출 수, `loadedState` 할당 수 | Hibernate Statistics |
| **JVM 레벨** | Young GC 빈도, Eden 할당률 | Grafana + JFR |
| **애플리케이션 레벨** | TPS, p50/p95/p99 | Grafana (이미 셋업됨) |

### Grafana 신규 패널 (PromQL)

```promql
# 트랜잭션 커밋 수 (mode별)
rate(hibernate_transactions_total{mode="default"}[30s])
rate(hibernate_transactions_total{mode="readonly"}[30s])

# flush 호출 빈도
rate(hibernate_flushes_total[30s])

# HikariCP 커넥션 평균 점유 시간
histogram_quantile(0.95, rate(hikaricp_connections_usage_seconds_bucket[30s]))
```

---

## ✅ 체크리스트

- [ ] `ReplyQueryService`에 default/readOnly 두 메서드 추가
- [ ] `/api/dc1/reply/{id}?mode=...` API 추가
- [ ] Hibernate Statistics 활성화
- [ ] p6spy 의존성 추가 및 SQL 로깅 검증
- [ ] k6 baseline.js 기반 `dc1-readonly.js` 작성
- [ ] 3회 측정 실행 (각 3분씩)
- [ ] MySQL `Com_set_option` 카운터 Before/After 비교
- [ ] 결과를 `concurrency-cache-lab/docs/experiments/dc1-readonly.md`에 기록
- [ ] 이 문서 맨 아래 "측정 결과" 섹션에 수치 추가
- [ ] 이슈 close

---

## 🎯 기대 결과

| 메트릭 | default | readOnly (예상) | 의미 |
|--------|---------|-----------------|------|
| TPS | baseline | ≈ baseline ~ +5% | 조회 성능 큰 차이 X |
| p99 | baseline | baseline 대비 감소 가능 | flush 스킵 효과 |
| GC 빈도 | 기준 | **감소** | 스냅샷 미생성 |
| `Com_set_option` | 기준 | **감소** | readOnly 세션 재사용 |

> 실제 수치는 실험 후 기록.

---

## 🎤 면접 답변 연결

### 예상 질문
> "JPA에서 읽기 전용 트랜잭션의 효과를 설명해주세요."

### 답변 템플릿 (실험 완료 후)

> "`@Transactional(readOnly = true)`는 세 가지 레이어에서 최적화됩니다. 첫째, Hibernate가 **엔티티 스냅샷(loadedState) 생성을 생략**해 메모리와 GC 부하를 줄입니다. 둘째, JDBC 드라이버에 `setReadOnly(true)`가 호출되어 **MySQL에서 read-only 트랜잭션 최적화**가 활성화됩니다. 셋째, **flush 호출 자체가 생략**되어 dirty checking 비용이 없습니다.
>
> 카카오페이가 공개한 사례에서는 클래스 단위 `@Transactional` 남발로 MySQL `set_option` 쿼리가 14K 발생했는데, 읽기 전용 명시로 이걸 크게 줄였습니다. 저도 이 패턴을 repo에 재현해서 default vs readOnly로 k6 부하를 걸어 실측했고, [실측 수치를 여기에 적는다]."

---

## 📚 레퍼런스
- [카카오페이 JPA Transactional 사례](https://tech.kakaopay.com/post/jpa-transactional-bri/)
- [Vlad Mihalcea — Spring readOnly 최적화](https://vladmihalcea.com/spring-read-only-transaction-hibernate-optimization/)
- [MySQL 공식 문서 — START TRANSACTION READ ONLY](https://dev.mysql.com/doc/refman/8.0/en/commit.html)

---

## 📊 측정 결과

> 실험 완료 후 여기에 추가. (현재: 계획 단계)

| 지표 | default | readOnly | 차이 | 해석 |
|------|---------|----------|------|------|
| TPS (중앙값) | | | | |
| p99 | | | | |
| `Com_set_option` 증분 | | | | |
| Eden 할당률 | | | | |
