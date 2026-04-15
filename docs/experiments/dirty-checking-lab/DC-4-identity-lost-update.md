# DC-4. JDBC vs JPA — 같은 트랜잭션 내 자기 Lost Update 재현

> **Lab**: Dirty Checking Lab | **Phase**: 2 (쉬움)
> **핵심**: "JPA 1차 캐시가 없었다면 같은 트랜잭션 안에서도 자기 자신과 Lost Update가 난다"

---

## 📌 실무에서 발생하는 문제

### 증상
- 서비스 A가 같은 ID의 엔티티를 **각자 조회 후 각자 저장**
- JDBC/MyBatis 스타일: 같은 트랜잭션에서도 조회마다 새 객체 반환
- 서로가 서로의 변경을 덮어씀 → **같은 트랜잭션 안에서 Lost Update**

### 흔한 안티패턴
```java
// 잘못된 패턴 (발견하기 어려움)
@Transactional
public void process(Long id) {
    validationService.validateAndMark(id);   // 내부: SELECT + UPDATE (A 객체)
    lockService.acquireLock(id);             // 내부: SELECT + UPDATE (B 객체)
    // A의 변경이 B에게 덮어쓰일 수 있음
}
```

### 왜 눈에 안 띄는가
- **에러가 나지 않음**
- 같은 트랜잭션 안에서 벌어지는 일이라 격리 수준과 무관
- 테스트에서 직렬로 실행되면 재현 안 됨
- 코드 리뷰에서 "같은 엔티티를 두 번 조회한다"는 패턴을 간과

---

## 🏢 연결된 공개 사례

### 1. Vlad Mihalcea — JPA and Hibernate first-level cache
**원문**: https://vladmihalcea.com/jpa-hibernate-first-level-cache/

**핵심 요지**:
- 1차 캐시는 **동일성(identity) 보장**의 핵심
- 같은 트랜잭션 안에서 같은 ID로 조회하면 **항상 같은 Java 객체 인스턴스 반환**
- `==` 비교까지 true → 메모리 동일성
- 이게 없으면 애플리케이션 레이어에서 일관성이 깨진다

### 2. Hibernate 공식 문서 — Persistence Context 범위
**원문**: https://docs.hibernate.org/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#persistence-context

**관련 개념**:
- Persistence Context는 **세션(트랜잭션) 범위**
- managed 엔티티의 identity를 트랜잭션 동안 보장
- "application-level repeatable read" 효과

### 3. Baeldung — Hibernate First-Level Cache
**원문**: https://www.baeldung.com/hibernate-first-level-cache

**예제**:
- 같은 트랜잭션에서 `find()` 두 번 호출 시 DB는 1번만 조회됨
- 두 객체 참조가 `==` 동일

---

## 💼 본인 실무와의 연결점

### 관찰 패턴 (레거시 MyBatis 또는 JDBC 코드)
```java
// MyBatis 스타일 가상 코드
@Transactional
public void refundAndNotify(Long orderId) {
    Order a = orderMapper.selectById(orderId);  // 새 객체 A
    a.setStatus(REFUNDED);
    orderMapper.update(a);

    Order b = orderMapper.selectById(orderId);  // 다른 새 객체 B (A의 상태 반영 X? 반영 O? 일관성 없음)
    b.setNotifiedAt(now());
    orderMapper.update(b);
}
// 트랜잭션 안에서도 두 객체가 독립적 → Lost Update 가능
```

### 이 실험이 답하려는 질문
1. **실제로 JDBC 스타일에서 자기 Lost Update가 재현되는가?**
2. JPA는 같은 시나리오에서 어떻게 일관성을 유지하는가?
3. 두 객체의 `==` 비교, `hashCode` 등이 어떻게 다른가?

---

## 🎯 가설

1. **H1**: JDBC 스타일로 짠 코드에서 같은 트랜잭션 내 두 번 조회 → 서로 다른 객체 반환
2. **H2**: 각 객체가 서로 다른 필드를 변경 후 저장 → 마지막 저장의 변경만 DB에 남음 (Lost Update)
3. **H3**: JPA 버전에선 같은 객체 반환되어 모든 변경이 하나의 UPDATE에 통합
4. **H4**: 성능적으로도 JPA는 SELECT 1회 + UPDATE 1회, JDBC는 SELECT 2회 + UPDATE 2회

---

## 🔧 구현 방법

### JDBC 버전 (대조군)

```java
@Service
public class DC4JdbcService {
    private final JdbcTemplate jdbc;

    @Transactional
    public void selfLostUpdate(Long id) {
        // 1차 조회
        ReplyRequest a = jdbc.queryForObject(
            "SELECT * FROM reply_requests WHERE id = ?",
            (rs, rn) -> toReply(rs), id);

        // 2차 조회 — 같은 트랜잭션, 그러나 새 객체
        ReplyRequest b = jdbc.queryForObject(
            "SELECT * FROM reply_requests WHERE id = ?",
            (rs, rn) -> toReply(rs), id);

        // 각자 다른 필드 변경
        a.markProcessing();            // retry_count += 1
        b.setLastAttemptedAt(now());   // last_attempted_at 갱신 (but retry_count는 원래 값)

        // 각자 저장
        jdbc.update("UPDATE reply_requests SET retry_count = ?, request_status = ? WHERE id = ?",
            a.getRetryCount(), a.getRequestStatus().name(), id);
        jdbc.update("UPDATE reply_requests SET last_attempted_at = ?, retry_count = ? WHERE id = ?",
            b.getLastAttemptedAt(), b.getRetryCount(), id);
        // ↑ b는 자기가 본 retry_count(원래 값)를 기준으로 덮어씀 → a의 증가 소실
    }
}
```

### JPA 버전 (실험군)

```java
@Service
public class DC4JpaService {
    @Transactional
    public void noLostUpdate(Long id) {
        ReplyRequest a = replyRepo.findById(id).orElseThrow();  // SELECT 1회
        ReplyRequest b = replyRepo.findById(id).orElseThrow();  // 1차 캐시 → 같은 객체

        // assert a == b (true)

        a.markProcessing();
        b.setLastAttemptedAtNow();
        // 둘 다 같은 객체이므로 변경 누적
    }
    // 자동 flush 시 UPDATE 1번, 모든 필드 반영
}
```

### 검증 테스트

```java
@SpringBootTest
class DC4IdentityLostUpdateTest {

    @Test
    void jdbc_style_should_lose_retry_count() {
        // given: retry_count=0
        seed(1L, 0);

        // when
        dc4JdbcService.selfLostUpdate(1L);

        // then: retry_count=0 (a의 증가가 b에 의해 덮어쓰여짐)
        ReplyRequest r = replyRepo.findById(1L).orElseThrow();
        assertThat(r.getRetryCount()).isZero();   // ★ Lost!
        assertThat(r.getLastAttemptedAt()).isNotNull();  // b의 변경만 반영
    }

    @Test
    void jpa_should_merge_all_changes() {
        seed(1L, 0);

        dc4JpaService.noLostUpdate(1L);

        ReplyRequest r = replyRepo.findById(1L).orElseThrow();
        assertThat(r.getRetryCount()).isEqualTo(1);   // ★ 반영됨
        assertThat(r.getLastAttemptedAt()).isNotNull();
    }

    @Test
    void jpa_returns_same_instance() {
        seed(1L, 0);

        transactionTemplate.executeWithoutResult(s -> {
            ReplyRequest a = replyRepo.findById(1L).orElseThrow();
            ReplyRequest b = replyRepo.findById(1L).orElseThrow();
            assertThat(a).isSameAs(b);   // ★ == 동일성 보장
        });
    }
}
```

---

## 📊 측정 메트릭 (이 실험은 부하 테스트가 아님)

| 축 | 측정 대상 | 수단 |
|----|-----------|------|
| **정합성** | JDBC: Lost Update 재현 여부 | 검증 테스트 |
| **정합성** | JPA: 동일 인스턴스 보장 | `assertThat(a).isSameAs(b)` |
| **SQL 수** | JPA: SELECT 1, UPDATE 1 / JDBC: SELECT 2, UPDATE 2 | p6spy 카운트 |
| **실행 시간** | 각 버전 평균 ms | JUnit 측정 |

---

## ✅ 체크리스트

- [ ] `DC4JdbcService` (JdbcTemplate 사용)
- [ ] `DC4JpaService` (JPA repository 사용)
- [ ] 검증 테스트 3종:
  - [ ] JDBC 자기 Lost Update 재현
  - [ ] JPA 자기 Lost Update 방지
  - [ ] JPA 동일 인스턴스 보장
- [ ] p6spy로 SQL 수 카운트
- [ ] 결과 기록 + 면접 답변 정리

---

## 🎯 기대 결과

| 시나리오 | retry_count 결과 | SELECT | UPDATE |
|----------|:-:|:-:|:-:|
| JDBC `selfLostUpdate` | **0 (Lost!)** | 2 | 2 |
| JPA `noLostUpdate` | **1 (정상)** | 1 | 1 |
| JPA 동일 인스턴스 | `a == b` = **true** | 1 | - |

---

## 🎤 면접 답변 연결

### 예상 질문
> "JPA와 JDBC/MyBatis의 차이점을 정합성 관점에서 설명해보세요."

### 답변 템플릿

> "JPA의 **1차 캐시는 같은 트랜잭션 내에서 같은 ID로 조회하면 항상 같은 Java 객체 인스턴스를 반환**합니다. `==` 비교까지 true가 보장돼서, 여러 서비스가 각자 조회 후 각자 수정해도 같은 객체에 변경이 누적되고 하나의 UPDATE로 통합 반영됩니다.
>
> JDBC/MyBatis는 이 보장이 없어서, 같은 트랜잭션 안에서 같은 ID를 두 번 조회하면 서로 다른 객체가 반환되고 각자 수정 후 저장하면 Lost Update가 발생할 수 있습니다. 저는 이 차이를 테스트로 재현해서 repo에 남겼습니다. JDBC 버전에선 retry_count가 0으로 소실되고, JPA 버전에선 정상적으로 1이 반영됩니다.
>
> 이건 **Dirty Checking의 '쓰기 편의성'과는 별개의 이점**이고, 분산 환경 동시성과 혼동되면 안 됩니다. 분산 환경의 Lost Update는 락으로, 이런 '트랜잭션 내 자기 Lost Update'는 1차 캐시로 방지되는 구조입니다."

---

## 📚 레퍼런스
- [Vlad Mihalcea — JPA First-Level Cache](https://vladmihalcea.com/jpa-hibernate-first-level-cache/)
- [Baeldung — Hibernate First-Level Cache](https://www.baeldung.com/hibernate-first-level-cache)
- [Hibernate 공식 — Persistence Context](https://docs.hibernate.org/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#persistence-context)

---

## 📊 측정 결과

> 실험 후 추가. (현재: 계획 단계)
