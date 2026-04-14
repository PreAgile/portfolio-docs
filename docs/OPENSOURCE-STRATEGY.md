# 오픈소스 기여 전략 — Java/Kotlin/Spring 커버 로드맵

> **목표**: 오픈소스 기여로 Java/Kotlin/Spring 실력을 증명하고, 면접에서 "코드 레벨에서 이해하고 있다"를 방어
> **현재 상태**: 외부 오픈소스 10개 PR 머지 (kotest 6, hoplite 1, spring-cloud-gateway 1, testcontainers 1, bullmq 1)
> **작성일**: 2026-04-06

---

## 1. 현재 기여 현황 — 전체 PR 분석

### 1-1. PR별 기술 깊이 & 면접 어필도

| # | 프로젝트 | PR | 난이도 | 핵심 기술 | 면접 어필도 |
|---|---------|-----|:---:|----------|:---:|
| 1 | kotest | #5789 type-safe shouldEqual | **Hard** | @OnlyInputTypes 컴파일러 내부 API, 메인테이너 5명 네이밍 합의 | ★★★★★ |
| 2 | kotest | #5828 Native IR 크래시 수정 | **Hard** | Kotlin/Native IR 링커 심볼 바운딩, klib 병합 메커니즘 | ★★★★★ |
| 3 | kotest | #5807 anyOf/oneOf JsonSchema | **Hard** | kotlinx.serialization 다형성 역직렬화, DSL 빌더, 440줄 | ★★★★★ |
| 4 | kotest | #5835 collection data class diff | **Medium** | Eq 타입클래스, 리플렉션, EnvironmentConfigValue 패턴 | ★★★★ |
| 5 | kotest | #5795 커스텀 Json 파서 | **Medium** | 바이너리 호환성 설계, KMP 소스셋, 11개 파일 오버로드 | ★★★★ |
| 6 | kotest | #5756 chainable assertion | **Easy** | Fluent API, ABI 호환성, 첫 기여 프로세스 학습 | ★★ |
| 7 | hoplite | #517 strict mode prefix 버그 | **Medium** | 설정 파싱 파이프라인 추적, strict 검증 로직, 7줄 수정 5개 테스트 | ★★★ |
| 8 | spring-cloud-gateway | #4130 DCO 문서 | **Docs** | Spring Cloud 생태계 진입 | ★ |
| 9 | testcontainers-java | #11564 k6 문서 | **Docs** | Java 테스트 인프라 | ★ |
| 10 | bullmq | #3923 IPC 프록시 | **Medium** | IPC 메시지 패턴, 프로세스 격리, v5.73.0 릴리스 | ★★★ |

### 1-2. 이미 증명된 역량

| 역량 | 증거 | 커버하는 JD |
|------|------|-----------|
| **Kotlin 타입 시스템 심화** | #5789 @OnlyInputTypes, #5828 Native IR, #5807 DSL 빌더 | 토스, 당근, 우아한 (Kotlin 필수) |
| **Kotlin Multiplatform 이해** | #5828 JVM/Native/JS 차이 진단 | 차별화 포인트 |
| **kotlinx.serialization** | #5807 다형성 역직렬화, #5795 커스텀 Json | API 설계, 데이터 직렬화 |
| **바이너리 호환성 설계** | #5795 오버로드 전략, #5756 ABI 체크 | 라이브러리/SDK 개발 관점 |
| **오픈소스 커뮤니케이션** | #5789 메인테이너 5명 합의, 리뷰 피드백 반영 | 협업, 코드 리뷰 문화 |
| **크로스스택** | bullmq(TS) + kotest(Kotlin) + testcontainers(Java) | "다양한 생태계 이해" |

### 1-3. 아직 부족한 역량 (오픈소스로 채워야 함)

| 갭 | 현재 상태 | 필요한 기여 레벨 |
|----|----------|---------------|
| **Spring 내부 동작** (IoC, AOP, @Transactional) | docs PR 1개뿐 | **코드 레벨** 버그 수정 또는 기능 개선 |
| **분산 시스템** (서킷 브레이커, 분산 락) Java 구현 | 실무는 Node.js/Python | Resilience4j or Redisson **코드 PR** |
| **JPA/Hibernate** | 경험 없음 | Exposed(Kotlin ORM) or Spring Data JPA 관련 |
| **Kafka Java 생태계** | ADR 이론만 | Spring Kafka **버그 수정** 또는 **기능 PR** |
| **성능/인프라** | HikariCP 등 분석만 | 커넥션 풀/메트릭 관련 PR |

---

## 2. 타겟 프로젝트 — 기여 가능성 & 면접 임팩트 분석

### Tier S: 반드시 기여해야 하는 프로젝트

#### 2-S-1. Resilience4j (resilience4j/resilience4j)

**왜 이것인가:**
- cmong-scraper에서 **직접 구현한 서킷 브레이커**(적응형 트래픽 제어)와 1:1 대응
- 토스, 쿠팡, 라인 면접에서 "장애 대응" 질문 시 직접 연결
- Spring Boot 3 통합 모듈 있음 → Spring 생태계 이해 증명

**현재 열린 이슈 중 타겟:**

| 이슈 | 난이도 | 왜 할 수 있는가 |
|------|:---:|--------------|
| [#2383] Default Aspect Order — Retry가 CircuitBreaker 밖에 위치하여 실패 카운트 부풀림 | **Medium-Hard** | Spring AOP 순서 이해 필요. @Transactional 프록시와 같은 원리 |
| [#2296] TimeLimiter가 타임아웃 후 스레드를 종료하지 않아 Bulkhead 스레드 고갈 | **Hard** | 스레드 관리 + Bulkhead 패턴. cmong-scraper 좀비 프로세스 관리와 유사 |
| [#2353] Micrometer Context Propagation 지원 | **Medium** | 모니터링. cmong-be OpenTelemetry 경험과 연결 |
| [#2189] ConcurrentModificationException in spring-boot3 | **Medium** | 동시성 버그. Java concurrent 컬렉션 이해 필요 |

**면접 스토리:**
> "cmong-scraper에서 적응형 트래픽 제어(CLOSED→SOFT_OPEN→HALF_OPEN)를 직접 구현한 경험이 있어서,
> Resilience4j의 CircuitBreakerStateMachine 소스를 분석했습니다. 
> 특히 [이슈 번호]에서 [문제]를 해결하면서, Spring AOP와 서킷 브레이커의 상호작용을 깊이 이해했습니다."

**목표:** 코드 레벨 PR **1~2개** (버그 수정 or 기능 개선)

---

#### 2-S-2. kotest — Spring 확장 & Coroutine 영역 (kotest/kotest)

**왜 이것인가:**
- 이미 **6개 PR 머지**로 메인테이너 신뢰 확보 → 더 큰 PR 수용 가능성 높음
- Spring 확장 모듈(kotest-extensions-spring)이 상대적으로 관리 안 되는 상태
- Coroutine 테스트 관련 이슈가 꾸준히 열림 → 토스/당근 Coroutine 역량 증명

**현재 열린 이슈 중 타겟:**

| 이슈 | 난이도 | 왜 할 수 있는가 |
|------|:---:|--------------|
| [#5813] Spring extension — kotest5→6 마이그레이션 문서 | **Easy-Medium** | Spring + kotest 교차점. Spring TestContext 이해 |
| [#3705] nested container가 testCoroutineScheduler를 상속해야 하는가? | **Hard** | Coroutine 테스트 스케줄러 설계. Structured Concurrency 심화 |
| [#3482] TestContainers에서 test factory inclusion | **Medium** | Testcontainers + kotest 통합. 이미 testcontainers PR 경험 있음 |
| [#5202] Map/Collection 상속 data class 비교 버그 | **Medium** | #5835에서 이미 CollectionEq 작업한 경험 직결 |
| [#5601] CustomEq가 data class 내부에서 실패 | **Medium** | Eq 타입클래스. #5835 연장선 |

**면접 스토리:**
> "kotest에 10개 이상 PR을 기여하면서, Easy(chainable assertion)부터
> Hard(Kotlin 컴파일러 내부 API, Native IR 크래시)까지 점진적으로 깊이를 높였습니다.
> 특히 Spring 확장 모듈에서 [이슈]를 해결하면서 Spring TestContext와 kotest 라이프사이클의
> 통합 방식을 이해했습니다."

**목표:** Spring 확장 or Coroutine 관련 PR **1~2개** → Kotlin+Spring 교차점 증명

---

### Tier A: 강력 추천 프로젝트

#### 2-A-1. Spring Kafka (spring-projects/spring-kafka)

**왜 이것인가:**
- ADR-001에서 이미 Kafka vs RabbitMQ 분석 완료 → 이론은 탄탄
- 카카오, 토스, 쿠팡, 우아한 전부 Kafka 사용
- 실제 코드 기여 시 "Kafka를 코드 레벨에서 이해한다" 증명

**현재 열린 이슈 중 타겟:**

| 이슈 | 난이도 | 왜 할 수 있는가 |
|------|:---:|--------------|
| [#4384] DefaultConsumerFactory에서 non-string Properties 처리 불일치 | **Medium** | 버그 수정. Factory 패턴 이해 필요 |
| [#4371] 멀티 파티션 배치 리스너에서 Backoff가 recovery를 깨뜨림 | **Hard** | 에러 핸들링. cmong-mq DLQ 경험과 직결 |
| [#4327] share consumer container에 stop/failure 라이프사이클 이벤트 추가 | **Medium** | 이벤트 기반 아키텍처. cmong-be EventEmitter2 경험 |

**목표:** 버그 수정 PR **1개** → "Spring Kafka 내부를 이해하고 기여했다"

---

#### 2-A-2. Armeria (line/armeria) — 라인 타겟 시

**왜 이것인가:**
- LINE이 직접 만든 오픈소스. 라인 면접에서 "Armeria를 분석하고 기여했다"는 최강 시그널
- Netty 기반 비동기 HTTP/2, gRPC 서버 → 네트워크 심화 이해

**현재 열린 good-first-issue:**

| 이슈 | 난이도 | 설명 |
|------|:---:|------|
| KafkaLogWriter 추가 | **Medium** | Kafka + Armeria 통합. Kafka 경험 활용 |
| BasicAuth AuthFailureHandler 기본 구현 | **Easy-Medium** | 인증 실패 핸들링 |
| WebClient JSON 전송 편의 메서드 | **Easy-Medium** | HTTP 클라이언트 개선 |
| HealthChecker 구현체 추가 | **Easy** | 헬스체크. cmong-scraper 경험 |
| Blocking task 기반 쓰로틀링 전략 | **Medium-Hard** | Rate Limiting. cmong-scraper 적응형 트래픽 제어와 직결 |

**면접 스토리:**
> "LINE의 오픈소스인 Armeria에 기여했습니다. 특히 [throttling strategy/KafkaLogWriter]를 구현하면서
> Netty 기반 비동기 아키텍처와 백프레셔 처리를 이해했습니다."

**목표:** good-first-issue **1개** + 중간 난이도 **1개**

---

#### 2-A-3. JetBrains Exposed (JetBrains/Exposed) — JPA 대안 Kotlin ORM

**왜 이것인가:**
- Kotlin 네이티브 ORM → JPA/Hibernate와 비교 관점
- TypeORM 경험이 있으므로 ORM 내부 동작 이해 바탕
- 토스/당근에서 Exposed 사용하는 팀 있음

**현재 이슈 중 타겟:**
- Kotlin/Native 지원 (#635) — 이미 kotest Native IR 경험 있음
- 트랜잭션 관련 이슈들 — cmong-be 결제 트랜잭션 경험 활용

**목표:** 이슈 분석 후 **1개 PR** → "JPA와 Exposed의 트레이드오프를 이해한다"

---

### Tier B: 선택적 (시간 여유 시)

| 프로젝트 | 왜 | 실무 연결 | 목표 |
|---------|-----|----------|------|
| **Redisson** | Redis 분산 락 Java 구현 | cmong-be SET NX+Lua | 소스 분석 (PR 선택적) |
| **HikariCP** | 커넥션 풀 내부 동작 | TypeORM 풀 설정 경험 | 소스 분석 (PR 어려움 — 메인테이너가 거의 혼자) |
| **Spring Boot** (core) | @Transactional, Auto Configuration | NestJS DI/IoC | 소스 분석 + ideal-for-contribution 이슈 |
| **kotlinx.coroutines** | Coroutine 내부 동작 | cmong-mq 동시성 | 소스 분석 (PR 난이도 매우 높음) |

> **참고: Redisson과 HikariCP는 PR보다 소스 분석이 현실적.**
> Redisson은 메인테이너(Nikita Koksharov)가 대부분 직접 수정하고, 외부 PR 수용률이 낮음.
> HikariCP도 Brett Wooldridge가 사실상 1인 관리. 코드 분석으로 면접에서 "소스를 읽어봤다"로 활용.

---

## 3. 이슈 난이도별 기여 가이드

### 3-1. 어떤 이슈를 골라야 하는가

**5년차 시니어가 "도전적이지만 현실적인" 이슈 기준:**

```
❌ Docs 수정만 — 이미 spring-cloud-gateway, testcontainers에서 했음. 더 하면 역효과
❌ typo 수정 — 시니어한테 어울리지 않음
❌ 너무 큰 리팩터링 — 머지되기까지 수개월 걸릴 수 있음

✅ 버그 수정 (Medium) — 원인 추적 + 수정 + 테스트. "문제 해결 능력" 증명
✅ 기능 추가 (Medium-Hard) — 설계 + 구현 + 리뷰 대응. "설계 능력" 증명  
✅ 성능 개선 — 벤치마크 + 수정. "성능 감각" 증명
✅ 2년+ 오픈 이슈 해결 — kotest #5807(anyOf/oneOf)처럼 "아무도 안 했던 걸 내가 했다"
```

### 3-2. 이슈 선택 체크리스트

```
□ 이 이슈를 해결하면 면접에서 어떤 기술 키워드를 어필할 수 있는가?
□ 기존 실무 경험(cmong-*)과 연결점이 있는가?
□ 리뷰가 활발한 프로젝트인가? (PR 올려도 무시당하면 시간 낭비)
□ 나의 현재 실력으로 2주 이내에 해결 가능한가?
□ 코드 레벨 변경인가? (docs만으로는 더 이상 의미 없음)
```

### 3-3. 난이도별 목표

| 난이도 | 기대 효과 | 현재 보유 | 추가 목표 |
|-------|---------|---------|---------|
| **Docs** | 프로젝트 진입, 기여 프로세스 학습 | ✅ 2개 (SCG, TC) | 더 필요 없음 |
| **Easy** | 코드 레벨 진입, 메인테이너 신뢰 구축 | ✅ 1개 (kotest #5756) | Armeria good-first-issue 1개 |
| **Medium** | 문제 해결 능력 증명 | ✅ 4개 (kotest 2, hoplite 1, bullmq 1) | Resilience4j 1개 + Spring Kafka 1개 |
| **Hard** | 시니어 레벨 설계/분석 능력 증명 | ✅ 3개 (kotest 3) | Resilience4j 스레드 이슈 or kotest Coroutine |

---

## 4. 면접에서의 오픈소스 어필 전략

### 4-1. 면접관 질문 패턴별 방어

#### "오픈소스에 기여한 경험이 있나요?"

**현재 답변 (이미 강력함):**
> "Kotlin 테스트 프레임워크 kotest에 6개 PR, Spring Cloud Gateway, Testcontainers-Java,
> BullMQ 등 총 10개 이상의 PR이 머지되었습니다. 
> 특히 kotest에서는 Kotlin 컴파일러 내부 API(@OnlyInputTypes)를 활용한 type-safe assertion을 
> 설계했고, 그 과정에서 발생한 Native IR 크래시를 직접 디버깅하여 수정했습니다."

#### "Java/Kotlin/Spring 경험이 부족한 것 같은데?"

**방어:**
> "실무에서는 Node.js/Python을 사용했지만, Kotlin 생태계에서 kotest에 Hard 레벨 PR 3개를 
> 포함해 6개를 기여하면서 Kotlin 타입 시스템, kotlinx.serialization, Multiplatform을 
> 코드 레벨에서 이해했습니다. 또한 Resilience4j에 [구체적 PR]을 기여하면서 
> Spring AOP와 서킷 브레이커의 통합 구조를 파악했습니다.
> 같은 문제를 Node.js와 Java/Kotlin 양쪽에서 풀어본 경험이 오히려 
> '왜 이 방식이 다른가'를 비교 관점으로 설명할 수 있는 강점이 됩니다."

#### "이 PR에서 가장 어려웠던 점은?"

**#5789+#5828 조합 (최강 스토리):**
> "type-safe assertion을 설계할 때, Kotlin의 @OnlyInputTypes 내부 어노테이션을 활용하는 
> 섀도 선언 접근법을 사용했는데, 이것이 Kotlin/Native에서 IR 링커 크래시를 일으켰습니다.
> JVM은 클래스패스 우선순위로 같은 FQCN을 처리하지만, Native는 klib을 단일 IR로 병합하기 때문에 
> 심볼 충돌이 발생한 것이 근본 원인이었습니다.
> 가장 어려웠던 점은 '내 코드가 만든 버그를 인정하고 빠르게 수정하는 것'이었습니다.
> 이슈 리포트 후 24시간 내에 원인 분석과 수정 PR을 올렸습니다."

**#5807 (가장 큰 feature):**
> "2년 이상 오픈되어 있던 이슈(#4463)를 해결했습니다. 어려웠던 점은 
> kotlinx.serialization의 다형성 역직렬화에서 anyOf/oneOf를 기존 type 기반 디스패치와 
> 충돌 없이 통합하는 것이었습니다. selectDeserializer에서 anyOf/oneOf를 type보다 
> 먼저 체크해야 하는 이유를 JSON Schema 스펙에서 도출하고, 
> 리뷰에서 나온 4가지 피드백을 모두 반영했습니다."

#### "소스코드를 분석한 경험이 있나요?"

> "kotest의 Eq 타입클래스 구조, CollectionEq 비교 파이프라인, kotlinx.serialization의 
> JsonContentPolymorphicSerializer를 소스 레벨에서 분석했습니다.
> 또한 Resilience4j의 CircuitBreakerStateMachine을 분석하여 
> 직접 구현한 적응형 트래픽 제어와 비교했고, [구체적 차이점]을 발견했습니다.
> HikariCP의 ConcurrentBag과 커넥션 풀 라이프사이클도 분석하여 
> 커넥션 풀 사이즈 튜닝의 근거를 이해했습니다."

### 4-2. 꼬리질문 방어 — PR별 핵심

#### kotest #5789 (type-safe shouldEqual)

| 단계 | 질문 | 답변 핵심 |
|------|------|----------|
| 1 | "@OnlyInputTypes가 뭔가요?" | Kotlin 컴파일러가 타입 추론 시 Any 추론 방지. `contains()`에도 같은 메커니즘 |
| 2 | "왜 shouldBe를 직접 수정 안 했나요?" | 10년치 레거시. breaking change 불가. 점진적 마이그레이션 전략 |
| 3 | "멀티플랫폼에서 문제가 왜 생겼나요?" | JVM은 클래스패스 우선순위, Native는 IR 병합 시 심볼 충돌 |
| 4 | "INVISIBLE_REFERENCE 억제가 안전한가요?" | Kotlin stdlib이 내부적으로 같은 패턴 사용. 바이트코드 동일. Kotlin 버전 변경 시 깨질 수 있으나 public API가 아니므로 허용 범위 |

#### kotest #5807 (anyOf/oneOf)

| 단계 | 질문 | 답변 핵심 |
|------|------|----------|
| 1 | "anyOf와 oneOf 차이?" | anyOf: 하나 이상 매칭. oneOf: 정확히 하나만 매칭 |
| 2 | "selectDeserializer 우선순위?" | anyOf/oneOf는 type 없이도 유효 → type보다 먼저 체크 |
| 3 | "재귀적 스키마는 어떻게 처리?" | anyOf 내부의 스키마를 재귀적으로 역직렬화. 기존 parse() 함수 재사용 |
| 4 | "성능 이슈는?" | anyOf: short-circuit(첫 매칭에서 중단). oneOf: 전체 순회 필수(count==1 확인). 대부분 스키마 크기가 작아 문제 없음 |

#### Resilience4j (향후 기여 대비)

| 단계 | 질문 | 답변 핵심 |
|------|------|----------|
| 1 | "서킷 브레이커 상태 전환 조건?" | failure rate + slow call rate. 슬라이딩 윈도우(count/time-based) |
| 2 | "직접 구현한 것과 Resilience4j 차이?" | 우리는 Redis 기반 분산 상태. Resilience4j는 단일 JVM. 토큰 버킷 Lua 스크립트로 원자적 처리 |
| 3 | "Spring AOP와 서킷 브레이커 순서 문제?" | @Order로 Retry가 CircuitBreaker 안에 위치해야 함. 아니면 재시도 실패가 CB 카운트에 중복 반영 |
| 4 | "분산 서킷 브레이커는 어떻게 만드나?" | Redis에 상태 저장 + Lua 스크립트로 원자적 상태 전환. 인스턴스 간 상태 공유 |

---

## 5. 프로젝트별 상세 분석 — 구체적 이슈 & 머지 확률

### 5-1. Resilience4j — 최우선 타겟 (머지 확률 70~80%)

**왜 머지 확률이 높은가:**
- maintainer `gavlyukovskiy`가 2026년 3월에만 15개+ PR 머지. 매우 활발
- 한국인 기여자 다수 (`KimDoubleB`, `seokjun7410`, `platanus-kr`, `zbnerd`)
- JUnit 6 마이그레이션 시리즈(14개 모듈)가 진행 중 → 진입점으로 최적

**구체적 이슈 타겟:**

| 이슈 | 난이도 | 설명 | 실무 연결 | 면접 임팩트 |
|------|:---:|------|----------|:---:|
| JUnit 4→6 마이그레이션 시리즈 | **Easy** | 14개 모듈. 코드베이스 파악용 | 테스트 문화 | ★★ |
| [#2383] Retry/CB Aspect Order 버그 | **Medium** | Spring AOP 순서로 failure count 부풀림 | cmong-scraper 서킷 브레이커 | ★★★★★ |
| [#2324] ignoreThrowablePredicate spin bug | **Medium** | 예외 처리 무한 루프 | 동시성 + 예외 처리 | ★★★★ |
| [#2296] TimeLimiter 스레드 미종료 → Bulkhead 고갈 | **Hard** | 스레드 관리 | cmong-scraper 좀비 프로세스 관리 | ★★★★★ |
| [#2224] Virtual Thread 지원 (synchronized→ReentrantLock) | **Hard** | JVM 21 핵심 주제 | Java 동시성 심화 | ★★★★★ |
| [#2353] Micrometer Context Propagation | **Medium** | 관측성 | cmong-be OpenTelemetry | ★★★ |

**추천 진입 경로:**
```
1단계: JUnit 6 마이그레이션 1개 (코드베이스 파악 + 첫 머지)
2단계: #2383 Aspect Order 버그 수정 (Spring AOP + CB = 최고 조합)
3단계: #2296 또는 #2224 (Hard 레벨 → 시니어 증명)
```

---

### 5-2. kotlinx.coroutines — 시니어 Kotlin 증명 (머지 확률 40~50%)

**왜 이것인가:**
- 토스/당근/우아한 모두 Coroutine 기반. 이 라이브러리 기여 = "Coroutine 내부를 이해한다"
- kotest 코루틴 이슈에서 자연스럽게 연결 가능 (kotest는 kotlinx.coroutines test 모듈의 최대 소비자)
- `help wanted` 라벨 이슈 존재

**구체적 이슈 타겟:**

| 이슈 | 난이도 | 설명 | 진입 경로 |
|------|:---:|------|----------|
| [#4580] 테스트 종료 시 스케줄러 미정리 | **Medium-Hard** | test 모듈 버그 | kotest 코루틴 경험에서 연결 |
| [#3179] 가상 시간 비활성화 옵션 | **Medium** | test 모듈 기능 추가 | kotest 테스트 인프라 확장 |
| [#4282] iOS SynchronizedObject 문제 | **Hard** | 멀티플랫폼 동시성 | kotest Native IR 경험 |

**kotest → kotlinx.coroutines 연결 스토리:**
> "kotest에서 코루틴 테스트 이슈(#3705 nested container scheduler 상속)를 분석하던 중,
> kotlinx.coroutines test 모듈의 스케줄러 정리 버그(#4580)를 발견해서 원천 수정까지 했습니다."

---

### 5-3. Spring Framework Kotlin 테마 — Expert 레벨 (머지 확률 30~40%)

**왜 이것인가:**
- `theme: kotlin` 라벨 이슈가 존재. Spring + Kotlin 교차점
- **이것 하나 머지되면 면접에서 "Spring + Kotlin 둘 다 코드 레벨" 증명 끝**

**핵심 이슈:**

| 이슈 | 난이도 | 설명 | 왜 할 수 있는가 |
|------|:---:|------|--------------|
| [#33788] Virtual Thread Coroutine dispatcher 탐구 | **Expert** | Dispatchers.Unconfined 위험성, VT dispatcher 설계 | Coroutine + JVM 21 교차점 |
| [#35774] R2DBC 코루틴 요청 취소 시 커넥션 누수 | **Hard** | 커넥션 풀 + 코루틴 취소 | cmong-be 커넥션 풀 경험 |
| [#36214] @Async 이벤트 리스너 + suspend 함수 에러 | **Medium** | Spring 이벤트 + 코루틴 | cmong-be EventEmitter2 경험 |

---

### 5-4. Spring Kafka — Kafka 코드 레벨 (머지 확률 30~40%)

**구체적 이슈 타겟:**

| 이슈 | 난이도 | 설명 | 실무 연결 |
|------|:---:|------|----------|
| [#4384] ConsumerFactory non-string Properties 버그 | **Medium** | 타입 불일치 | Factory 패턴 |
| [#4371] 멀티 파티션 배치에서 Backoff가 recovery 깨뜨림 | **Hard** | 에러 핸들링 | cmong-mq DLQ 경험 |
| [#4272] ConsumerRecordRecoverer 무한 재처리 | **Medium** | 무한 루프 버그 | 에러 복구 체계 |
| [#3295] read-committed + async-acks 충돌 | **Hard** | 트랜잭션 격리 + 비동기 | DB 격리 수준 지식 |

---

### 5-5. Armeria (LINE 오픈소스) — 라인 타겟 (머지 확률 50~60%)

**good-first-issue 존재 + 활발한 리뷰 문화**

| 이슈 | 난이도 | 설명 | 실무 연결 |
|------|:---:|------|----------|
| KafkaLogWriter 추가 | **Medium** | Kafka + Armeria 통합 | Kafka + 로깅 |
| Blocking task 기반 쓰로틀링 | **Medium-Hard** | Rate Limiting | cmong-scraper 적응형 트래픽 제어 |
| HealthChecker 구현체 추가 | **Easy** | 헬스체크 | cmong-scraper liveness/readiness |
| WebClient JSON 편의 메서드 | **Easy-Medium** | HTTP 클라이언트 | HTTP 요청 처리 |

---

### 5-6. Lettuce (Redis 공식 Java 클라이언트) — 깊이 (머지 확률 40~50%)

**Redis 전문성을 Java로 증명:**

| 이슈 | 난이도 | 설명 | 실무 연결 |
|------|:---:|------|----------|
| [#3609] BoundedAsyncPool 커넥션 누수 | **Hard** | 커넥션 풀 메모리 누수 | cmong-be 리소스 관리 |
| [#3481] Client-side caching invalidation race | **Hard** | 캐시 일관성 race condition | cmong-be 2계층 캐시 |
| [#3695] GCRA Rate Limiting | **Medium** | Redis 8.8 새 명령어 | cmong-scraper Rate Limiting |

---

### 5-7. kotest 확장 영역 — 이미 신뢰 확보 (머지 확률 90%+)

**메인테이너와 관계가 이미 구축되어 있으므로 가장 확실한 머지:**

| 이슈 | 난이도 | 설명 | 증명 역량 |
|------|:---:|------|----------|
| [#3705] nested container testCoroutineScheduler 상속 | **Hard** | 20개 댓글 설계 토론 | Coroutine 테스트 심화 |
| [#5813] Spring extension kotest5→6 마이그레이션 | **Medium** | Spring + kotest 교차 | Spring TestContext |
| [#5202] Map/Collection 상속 data class 비교 버그 | **Medium** | #5835 연장선 | Eq 타입클래스 |
| [#3482] TestContainers + test factory 통합 | **Medium** | testcontainers + kotest | 테스트 인프라 |

---

### 5-8. 추가 타겟 — Kotlin 생태계 확장

| 프로젝트 | 추천 이슈 | 난이도 | 증명 역량 |
|---------|---------|:---:|----------|
| **JetBrains/Exposed** | [#1586] suspend transaction 롤백 버그 | **Hard** | Kotlin ORM + Coroutine + 트랜잭션 |
| **JetBrains/Exposed** | [#377] 스키마 비교 API (good-first-issue) | **Easy** | Kotlin ORM 진입 |
| **kotlinx.serialization** | [#3015] polymorphicDefaultDeserializer 버그 | **Medium** | #5807 경험 활용 |
| **Arrow-kt** | [#3432] Resilience Saga 패턴 | **Hard** | 분산 시스템 + FP |
| **Ktor** | [#4720] HttpTimeout + test dispatcher | **Medium** | Coroutine 테스트 |
| **Spring AI** | good-first-issue 5개 열려있음 | **Easy-Medium** | Spring + AI (트렌디) |

---

## 6. 종합 실행 로드맵 (8주)

### Phase 1 (즉시 ~ 2주): 기존 강점 강화 + 새 프로젝트 진입

| 프로젝트 | 타겟 이슈 | 기대 효과 |
|---------|---------|---------|
| **kotest** | #5813 Spring extension or #5202 Eq 버그 | 빠른 머지 (메인테이너 신뢰) |
| **Resilience4j** | JUnit 6 마이그레이션 1개 | 코드베이스 파악 + 첫 머지 |

### Phase 2 (2~4주): 갭 메우기 — Java/Spring 코드 레벨

| 프로젝트 | 타겟 이슈 | 기대 효과 |
|---------|---------|---------|
| **Resilience4j** | #2383 Aspect Order 버그 | Java + Spring AOP + 서킷 브레이커 = 최고 조합 |
| **Spring Kafka** | #4384 ConsumerFactory 버그 | Kafka + Spring 통합 증명 |
| **kotest** | #3705 Coroutine scheduler (Hard) | Coroutine 심화 |

### Phase 3 (4~6주): 타겟 회사별 차별화

| 타겟 회사 | 프로젝트 | 이슈 |
|---------|---------|------|
| **라인** | Armeria | KafkaLogWriter or throttling strategy |
| **토스/당근** | kotlinx.coroutines | #4580 test 스케줄러 미정리 |
| **우아한** | Exposed | #1586 suspend transaction 롤백 or #377 진입 |

### Phase 4 (6~8주): Expert 레벨 도전 (선택)

| 프로젝트 | 이슈 | 임팩트 |
|---------|------|-------|
| **Spring Framework** | #33788 Virtual Thread + Coroutine dispatcher | 이것 하나로 시니어 증명 끝 |
| **Resilience4j** | #2224 Virtual Thread 지원 | JVM 21 + 동시성 |

### Phase 소스 분석만 (PR 없이): 면접 "소스 읽어봤다" 방어용

| 프로젝트 | 분석 대상 | 면접 활용 |
|---------|---------|---------|
| **Spring Framework** | TransactionInterceptor.java | "@Transactional 프록시가 CGLIB으로 생성되는 과정" |
| **HikariCP** | ConcurrentBag, HikariPool | "threadLocal + sharedList 커넥션 풀 전략" |
| **Redisson** | RedissonLock, watchdog | "SET NX Lua 직접 구현과 Redisson watchdog 비교" |
| **kotlinx.coroutines** | CancellableContinuationImpl | "suspend → resume CPS 변환 과정" |

---

## 7. 최종 목표 수치 (수정)

| 항목 | 현재 | 8주 후 목표 | 비고 |
|------|:---:|:---:|------|
| 외부 오픈소스 총 PR | 10개 | **16~20개** | +6~10개 |
| 코드 레벨 PR (docs 제외) | 8개 | **14~17개** | +6~9개 |
| Hard 난이도 PR | 3개 | **6~8개** | +3~5개 |
| 기여한 프로젝트 수 | 5개 | **8~10개** | +3~5개 |
| Java 프로젝트 코드 PR | 0개 | **3~4개** | Resilience4j, Spring Kafka, Armeria/Lettuce |
| Kotlin 프로젝트 코드 PR | 7개 | **11~14개** | kotest 확장, kotlinx.coroutines, Exposed |

**달성 시 포지셔닝:**
- "Kotlin: kotest+kotlinx.coroutines+Exposed에 10개+ 코드 PR" → Kotlin 역량 의심 불가
- "Java/Spring: Resilience4j+Spring Kafka에 3~4개 코드 PR" → Java 전환 능력 증명
- "분산 시스템: 서킷 브레이커+Kafka+Redis 라이브러리 기여" → 분산 시스템 깊이
- "총 16~20개 머지, Hard 6~8개" → 빅테크 시니어 오픈소스 기여자

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-04-06 | 초안. 현재 10개 PR 분석 + 타겟 프로젝트 5개 + 이슈 난이도별 가이드 |
