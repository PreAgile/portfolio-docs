# DC-5. 서비스 레이어 분리 시 SELECT/UPDATE 단일화 효과

> **Lab**: Dirty Checking Lab | **Phase**: 3 (중간 난이도)
> **핵심**: "여러 서비스가 같은 엔티티를 만질 때 JPA는 SELECT 1 + UPDATE 1, JDBC는 4 + 4"

---

## 📌 실무에서 발생하는 문제

### 증상
- 복잡한 비즈니스 로직을 여러 서비스로 분리
- 각 서비스가 자기 책임 범위 안에서 같은 엔티티를 조회/수정
- JDBC/MyBatis 스타일에서는 **같은 엔티티를 여러 번 DB에서 다시 조회**
- 불필요한 SELECT + UPDATE 폭주 → DB 부하, 응답 지연

### 전형적 시나리오
```java
// 레이어 분리된 비즈니스 플로우
@Transactional
public void processReplyFully(Long id) {
    validationService.validate(id);        // 내부: 엔티티 조회
    lockService.markLocked(id);            // 내부: 조회 + setLocked
    scraperClient.register(id);            // 외부 호출
    completionService.markCompleted(id);   // 내부: 조회 + markCompleted
}
```

### JDBC/MyBatis에서의 비용
- 서비스 4개 × (SELECT + UPDATE) = **4번 SELECT + 4번 UPDATE**
- 각 UPDATE가 직전 상태를 덮어쓸 위험 (DC-4와 같은 자기 Lost Update 가능)
- 운영에서 "왜 한 요청당 쿼리가 이렇게 많지?" 의문

---

## 🏢 연결된 공개 사례

### 1. Vlad Mihalcea — The JPA first-level cache
**원문**: https://vladmihalcea.com/jpa-hibernate-first-level-cache/

**핵심**:
- 1차 캐시는 "같은 세션 내 반복 조회 제거" + "엔티티 동일성 보장"의 두 역할
- 서비스 레이어가 분리돼도 같은 트랜잭션이면 DB는 1회만 조회

### 2. Thorben Janssen — Spring Data JPA Logging
**원문**: https://thorben-janssen.com/spring-data-jpa-logging/

**실무 팁**:
- `hibernate.generate_statistics=true`로 세션별 로드/플러시 카운트 확인
- 예상보다 많은 쿼리가 나가면 서비스 구조를 의심

### 3. 카카오페이 — JPA Transactional
**원문**: https://tech.kakaopay.com/post/jpa-transactional-bri/

**관련 교훈**:
- 서비스 레이어 클래스 단위 `@Transactional` 남발이 오히려 리소스 문제를 일으킨 사례
- 트랜잭션 범위 설계가 곧 쿼리 경로 설계

### 4. 일반 패턴 (다수의 JPA 성능 가이드)
- Baeldung, `joont92.github.io`, 김영한 JPA 교재 모두 1차 캐시 활용 강조

---

## 💼 본인 실무와의 연결점

### 관찰 패턴

```
(가설적 운영 상황)
- 댓글 처리 플로우가 Validation / Lock / External API / Completion 4단계
- 각 서비스가 자기 Repository를 통해 reply_request 조회
- 코드 리뷰 때는 "책임 분리"로 보이지만, JDBC/MyBatis 환경에선 쿼리 폭주
```

### 이 실험이 답하려는 질문
1. JPA vs JDBC 서비스 레이어 분리 시 실제 SQL 수 차이?
2. 트랜잭션 범위를 잘못 설계하면 (서비스마다 별도 트랜잭션) 1차 캐시 이점 사라지는가?
3. `REQUIRES_NEW` propagation이 1차 캐시에 미치는 영향?

---

## 🎯 가설

1. **H1**: 같은 `@Transactional` 범위 내에서 JPA는 SELECT 1회 + UPDATE 1회
2. **H2**: JDBC/MyBatis는 SELECT 4회 + UPDATE 4회
3. **H3**: 서비스마다 `@Transactional(REQUIRES_NEW)`로 걸면 JPA도 4 + 4가 됨 (1차 캐시 분리)
4. **H4**: 같은 트랜잭션 공유 시 TPS 향상, DB 부하 감소

---

## 🔧 구현 방법

### JPA 버전 (정상 설계)

```java
@Service
public class DC5ProcessReplyService {

    @Transactional
    public void processReplyFully(Long id) {
        validationService.validate(id);
        lockService.markLocked(id);
        scraperClient.register(id);
        completionService.markCompleted(id);
    }
}

@Service
public class ValidationService {
    @Transactional(propagation = Propagation.MANDATORY)
    public void validate(Long id) {
        ReplyRequest r = replyRepo.findById(id).orElseThrow();
        if (r.getRequestStatus() != PENDING) throw new IllegalStateException();
    }
}

@Service
public class LockService {
    @Transactional(propagation = Propagation.MANDATORY)
    public void markLocked(Long id) {
        ReplyRequest r = replyRepo.findById(id).orElseThrow();  // 1차 캐시 HIT
        r.setLocked(true);
    }
}

// ... CompletionService 등 동일 패턴
```

### JDBC 버전 (대조군)

```java
@Service
public class DC5JdbcProcessReplyService {
    @Transactional
    public void processReplyFully(Long id) {
        jdbcValidation.validate(id);       // SELECT
        jdbcLock.markLocked(id);           // SELECT + UPDATE
        scraperClient.register(id);
        jdbcCompletion.markCompleted(id);  // SELECT + UPDATE
    }
}
```

### REQUIRES_NEW 안티패턴 (추가 실험)
```java
@Service
public class LockServiceWithNewTx {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markLocked(Long id) {
        // 별도 트랜잭션 → 별도 Persistence Context → 1차 캐시 분리
        ReplyRequest r = replyRepo.findById(id).orElseThrow();  // ★ DB SELECT 발생
        r.setLocked(true);
    }
}
```

---

## 📊 측정 메트릭

| 축 | 메트릭 | 수단 |
|----|--------|------|
| **쿼리 수** | 각 시나리오의 SELECT/UPDATE 수 | p6spy + Hibernate Statistics |
| **응답 시간** | 각 시나리오 p50/p95/p99 | Grafana |
| **1차 캐시 HIT** | Hibernate Statistics의 sessionOpenCount vs entityLoadCount | Statistics |
| **DB 트래픽** | `Com_select`, `Com_update` 증분 | `SHOW STATUS` |

---

## ✅ 체크리스트

- [ ] `DC5ProcessReplyService` + 4개 하위 서비스 (JPA) 작성
- [ ] `DC5JdbcProcessReplyService` + 4개 하위 서비스 (JDBC) 작성
- [ ] `@Transactional(REQUIRES_NEW)` 안티패턴 버전 추가
- [ ] 각 버전에 대한 API 엔드포인트 (`/api/dc5/jpa/{id}`, `/api/dc5/jdbc/{id}`, `/api/dc5/new-tx/{id}`)
- [ ] k6로 동일 부하 3 시나리오 비교
- [ ] p6spy 로그에서 SQL 수 집계
- [ ] Hibernate Statistics 덤프
- [ ] 결과 기록

---

## 🎯 기대 결과

| 버전 | SELECT | UPDATE | TPS (상대) | 1차 캐시 |
|------|:-:|:-:|:-:|:-:|
| JPA 동일 트랜잭션 | **1** | **1** | 100% | HIT 3회 |
| JDBC 동일 트랜잭션 | **4** | **4** | ~70% | - |
| JPA REQUIRES_NEW | 4 | 4 | ~70% | MISS (분리됨) |

---

## 🎤 면접 답변 연결

### 예상 질문
> "서비스 레이어를 분리했는데 같은 엔티티를 여러 서비스가 만질 때 JPA는 어떤 이점이 있나요?"

### 답변 템플릿

> "같은 `@Transactional` 범위 안에서 JPA는 **1차 캐시로 엔티티 조회를 단일화**합니다. 서비스가 4개로 분리돼 각자 `findById`를 호출해도 **DB SELECT는 1번**이고, 각 서비스의 변경이 **같은 객체에 누적**되어 **UPDATE는 1번**으로 통합됩니다.
>
> JDBC/MyBatis로 동일하게 짜면 SELECT 4번 + UPDATE 4번으로 쿼리가 4배 늘고, 자기 Lost Update 위험까지 생깁니다. 제가 repo에 세 버전(JPA 동일 트랜잭션 / JDBC / JPA REQUIRES_NEW)을 만들어 k6로 비교했는데, 쿼리 수는 [수치]처럼 나왔고 TPS 차이는 [수치]였습니다.
>
> 주의할 점은 `@Transactional(REQUIRES_NEW)`를 잘못 붙이면 **하위 서비스마다 별도 트랜잭션 = 별도 Persistence Context**라서 1차 캐시가 분리되어 JDBC와 같은 패턴이 됩니다. 그래서 서비스 레이어 트랜잭션 경계 설계가 곧 쿼리 경로 설계라는 게 카카오페이 사례에서도 확인되는 지점입니다."

---

## 📚 레퍼런스
- [Vlad Mihalcea — JPA First-Level Cache](https://vladmihalcea.com/jpa-hibernate-first-level-cache/)
- [Thorben Janssen — Spring Data JPA Logging](https://thorben-janssen.com/spring-data-jpa-logging/)
- [카카오페이 — JPA Transactional](https://tech.kakaopay.com/post/jpa-transactional-bri/)
- [Spring 공식 — @Transactional Propagation](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)

---

## 📊 측정 결과

> 실험 후 추가. (현재: 계획 단계)
