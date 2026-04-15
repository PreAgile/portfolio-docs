# Dirty Checking Lab — 마스터 플랜

> **목적**: "JPA Dirty Checking이 실무에서 왜 문제가 되고, 어떻게 최적화하는가"를 **공개 사례 + 본인 실무 + 재현 실험**으로 증명.
> **Repo**: [concurrency-cache-lab](https://github.com/PreAgile/concurrency-cache-lab)
> **연결 Q&A**: [track1-01-lost-update.md § 토글 #9](../../interview-prep/qna/concurrency-cache-lab/track1-01-lost-update.md)

---

## 왜 이 Lab인가

Track 1(동시성)의 Lost Update 실험으로 **"JPA + 락"의 정합성 문제**를 증명했다면, 이 Lab은 **"JPA 자체의 성능/동작 특성"**을 파고듭니다. 두 축이 서로를 보완:

| 축 | Track 1 (Lost Update) | Dirty Checking Lab |
|----|----|----|
| **주제** | 정합성 축 — 락이 왜 필요한가 | 성능/동작 축 — JPA 내부 메커니즘 |
| **질문** | "락 없으면 얼마나 깨지나?" | "Dirty Checking은 얼마나 비싸고 어떻게 튜닝하나?" |
| **증거** | Lost Update 88건 실측 | readOnly/Enhancement/DynamicUpdate Before/After |

---

## 5개 실험 로드맵

| # | 실험 | 난이도 | 선행 레퍼런스 | Phase |
|:-:|------|:-:|----|:-:|
| **DC-1** | `@Transactional(readOnly=true)` 효과 | 쉬움 | 카카오페이 + Vlad Mihalcea | 1 |
| **DC-4** | JDBC vs JPA 자기 Lost Update | 쉬움 | Vlad Mihalcea (1차 캐시) | 2 |
| **DC-5** | 서비스 레이어 SELECT/UPDATE 단일화 | 중간 | 일반 JPA 패턴 | 3 |
| **DC-2** | `@DynamicUpdate` 트레이드오프 | 중간 | Thorben Janssen / Baeldung | 4 |
| **DC-3** | Bytecode Enhancement 벤치마크 | 어려움 | Vlad Mihalcea (벤치마크) | 5 |

**진행 순서 근거**:
- 쉬운 것부터 난이도 상승
- 앞 실험 결과가 뒤 실험 해석에 도움
- DC-3은 gradle plugin 설정이라 마지막

---

## 공통 실험 프로토콜

### 환경
- MySQL 8 (docker, CPU 1.0 / MEM 512M, localhost:13306)
- Spring Boot 3.3.5 + JDK 17
- HikariCP max 20

### 측정 도구
- **k6** 부하 테스트 (30s warm-up + 60s steady load)
- **Hibernate Statistics** (`generate_statistics=true`)
- **Prometheus + Grafana** 실시간 관측
- **p6spy** 실제 JDBC SQL 캡처
- **JFR** 필요 시 JVM 프로파일링

### 결과 기록 템플릿
각 실험 완료 시 `concurrency-cache-lab/docs/experiments/dc-N-*.md`에:
- 가설
- 환경 (재측정 가능하도록)
- 결과 수치 (3회 측정 중앙값)
- 해석
- 면접 한 줄

---

## 실험별 간단 요약

### 📄 [DC-1. readOnly 트랜잭션 효과](DC-1-readonly-transaction.md)
> "@Transactional 남발이 실제 운영에서 어떤 DB 리소스 문제를 일으키는가" — **카카오페이가 `set_option` 14K 쿼리 줄인 사례 재현**

### 📄 [DC-2. @DynamicUpdate 트레이드오프](DC-2-dynamic-update.md)
> "변경된 필드만 UPDATE가 항상 빠른가? Statement cache miss 비용까지 측정" — Thorben Janssen 가이드 + 본인 실측

### 📄 [DC-3. Bytecode Enhancement 벤치마크](DC-3-bytecode-enhancement.md)
> "대량 엔티티 관리 시 Enhancement가 진짜 10% 빨라지는가" — Vlad Mihalcea 벤치마크 재현

### 📄 [DC-4. JDBC vs JPA 자기 Lost Update](DC-4-identity-lost-update.md)
> "1차 캐시가 같은 트랜잭션 내 자기 Lost Update를 구조적으로 방지한다" — 실행 가능한 비교 테스트

### 📄 [DC-5. 서비스 레이어 SELECT/UPDATE 단일화](DC-5-service-layer-cache.md)
> "여러 서비스가 같은 엔티티를 만질 때 JPA는 SELECT 1회 + UPDATE 1회, JDBC는 4+4" — p6spy 실측

---

## 이 Lab으로 증명하려는 것

이 Lab의 목표는 **"Java/Spring/JPA를 표면 사용이 아니라 내부 동작·트레이드오프·운영 사고까지 이해하고 실측으로 검증한다"**는 해결력 증명입니다.

```
[운영 사고] → [CS 레벨 분해] → [공개 사례 대입] → [재현 가능 실험] → [수치 증명]
```

각 실험은 이 5단계를 모두 거칩니다:

```
운영 사고                    : "댓글 중복 등록 사고가 났다"
    ↓
CS 레벨 분해                 : "JPA Dirty Checking이 DB 상태 재확인 안 한다"
    ↓
공개 사례 대입               : "카카오페이, Vlad Mihalcea, Airbnb 글을 읽었다"
    ↓
재현 가능 실험               : "k6 + Hibernate Statistics로 측정"
    ↓
수치 증명                    : "readOnly 적용 시 메모리 X% 감소, p99 Yms 감소"
```

---

## 연결된 이슈

실험 진행 시 [concurrency-cache-lab 이슈](https://github.com/PreAgile/concurrency-cache-lab/issues)를 참조:
- `#DC-1 ~ #DC-5`로 각 실험 트래킹
- 완료 시 이 문서의 해당 줄에 **"✅ 완료"** + 커밋 해시 + 실측 수치 한 줄 추가

---

## 참고 레퍼런스 (전역)

### 국내
- [카카오페이 — JPA Transactional 잘 알고 쓰고 계신가요?](https://tech.kakaopay.com/post/jpa-transactional-bri/)
- [우아한형제들 — JPA 강의 소감과 적용 사례](https://techblog.woowahan.com/2598/)

### 해외 (Vlad Mihalcea — Hibernate 공식 커미터)
- [Anatomy of Hibernate Dirty Checking](https://vladmihalcea.com/the-anatomy-of-hibernate-dirty-checking/)
- [JPA First-Level Cache](https://vladmihalcea.com/jpa-hibernate-first-level-cache/)
- [Enable Bytecode Enhancement](https://vladmihalcea.com/how-to-enable-bytecode-enhancement-dirty-checking-in-hibernate/)
- [Spring Read-Only Transaction Optimization](https://vladmihalcea.com/spring-read-only-transaction-hibernate-optimization/)
- [Hibernate Performance Tuning Tips](https://vladmihalcea.com/hibernate-performance-tuning-tips/)

### 실무 패턴
- [Thorben Janssen — Spring Data JPA Logging](https://thorben-janssen.com/spring-data-jpa-logging/)
- [Baeldung — @DynamicUpdate](https://www.baeldung.com/spring-data-jpa-dynamicupdate)
