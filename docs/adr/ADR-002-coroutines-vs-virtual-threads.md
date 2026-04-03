# ADR-002: 비동기 처리 방식 - Kotlin Coroutines vs Virtual Threads

- **날짜**: 2026-04-03
- **상태**: 결정됨
- **결정자**: 본인
- **적용 범위**: platform-api, async-crawler

---

## 배경 및 문제 정의

platform-api와 async-crawler 모두 I/O 바운드 작업(DB 조회, 외부 HTTP 호출, Redis 조회)이 많다. 동기 방식(Spring MVC + 전통 스레드)으로는 요청당 스레드를 점유해 동시 처리량에 한계가 있다.

포트폴리오 프로젝트에서 이 문제를 해결하기 위한 비동기 처리 방식을 결정한다.

**핵심 질문**: 같은 문제를 Kotlin Coroutines로 풀 것인가, Java 21 Virtual Threads로 풀 것인가?

---

## 검토한 대안

### Option A: Spring MVC + Java 21 Virtual Threads
**어떻게 동작하는가**

Java 21에서 도입된 Project Loom. 기존 블로킹 코드를 그대로 쓰면서 JVM이 자동으로 Virtual Thread로 관리. `spring.threads.virtual.enabled=true` 한 줄로 활성화.

**장점**
- 기존 동기 코드 그대로 사용 → 학습 비용 0
- `synchronized`, `ThreadLocal` 등 기존 자바 생태계와 완전 호환
- 디버깅이 일반 스레드와 동일한 방식
- 코드 가독성 최고 (콜백/체이닝 없음)

**단점**
- Pinning 문제: `synchronized` 블록 안에서 블로킹 I/O 발생 시 Carrier Thread가 고정되어 성능 저하
- JPA/Hibernate의 일부 내부 `synchronized` 사용으로 인한 Pinning 위험
- Structured Concurrency는 Java 21에서 Preview 상태 (아직 불안정)
- Kotlin 코드에서는 Coroutines 없이 Reactive 스타일 표현이 불편

### Option B: Kotlin Coroutines (선택)
**어떻게 동작하는가**

코루틴은 경량 스레드가 아니라 **중단 가능한 계산 단위**. `suspend` 함수는 블로킹 없이 중단(suspend)했다가 재개(resume). JVM 스레드 풀 위에서 멀티플렉싱.

**장점**
- `suspend` 키워드로 비동기 코드를 동기처럼 작성 → 가독성 유지
- Structured Concurrency 기본 지원 → 코루틴 계층 구조로 생명주기 관리
- `Flow` 타입으로 스트리밍 데이터 처리 (Reactive 대안)
- Spring WebFlux와 연동 없이도 Spring MVC에서 사용 가능
- 토스, 카카오 실제 스택 (어필 포인트가 아닌 검증된 스택이라는 의미)
- 명시적 `Dispatcher` 선택으로 CPU/IO 바운드 작업 분리 가능

**단점**
- `suspend` 전파 문제: 하나의 함수를 `suspend`로 만들면 호출 스택 전체가 영향받음
- JPA와 함께 쓸 때 주의 필요 (`withContext(Dispatchers.IO)` 명시 필수)
- `runBlocking` 남용 시 코루틴 장점 소멸
- Pinning은 없지만 잘못된 Dispatcher 선택 시 스레드 고갈 가능

### Option C: Spring WebFlux + Project Reactor
**장점**
- 완전 논블로킹 I/O
- 낮은 메모리 사용 (스레드 수 최소화)

**단점**
- Reactive 파이프라인 학습 비용 높음
- 에러 처리, 디버깅이 복잡
- JPA(블로킹 API)와 함께 사용 불가 → R2DBC 필요 (생태계 미성숙)
- 코드 가독성 낮음 (`.flatMap().switchIfEmpty().onErrorResume()` 체이닝)

---

## AI와 함께 검토한 내용

**내가 AI에게 물어본 것**:
> "Virtual Threads가 나왔는데도 Coroutines를 선택해야 하는 이유가 있나요? 단순히 최신 기술이라서 Coroutines 쓰는 건 과잉 아닌가요?"

**AI 답변 요약**:
> "Virtual Threads는 '블로킹 코드를 쓰면서 스케일'하는 문제를 해결합니다. Coroutines는 '비동기 코드를 동기처럼 읽히게 쓰는' 문제를 해결합니다. 둘은 해결하는 문제가 다릅니다. Kotlin 프로젝트라면 Coroutines의 Structured Concurrency와 Flow API가 Virtual Threads에서는 얻기 어려운 표현력을 줍니다. 단, JPA + Coroutines 조합은 Dispatcher 관리를 잘못하면 오히려 더 복잡해질 수 있습니다."

**내 판단**:
AI 답변이 핵심을 짚었다. 이 프로젝트는 Kotlin을 쓰고, I/O 바운드가 많으며, 동시에 여러 외부 API를 병렬 호출하는 케이스가 있다. Coroutines의 `async { } + awaitAll()` 패턴이 Virtual Threads보다 명시적이고 제어하기 쉽다. 단, JPA 사용 시 `withContext(Dispatchers.IO)` 규칙을 팀 컨벤션으로 문서화한다.

---

## 결정: Kotlin Coroutines

### 선택 근거
1. **Structured Concurrency**: 여러 외부 API 병렬 호출 시 하나가 실패하면 나머지도 취소되는 동작이 명시적으로 표현됨. Virtual Threads에는 이 개념이 없음.
2. **Flow API**: 크롤러에서 대량 데이터를 스트리밍 처리할 때 `Flow<T>`가 자연스러운 표현. Reactor 없이 논블로킹 스트리밍 가능.
3. **suspend 함수 시그니처**: 함수 시그니처에 비동기 의도가 드러남. `fun fetchShop(id: Long): Shop`과 `suspend fun fetchShop(id: Long): Shop`은 의미가 다름. Virtual Threads는 이 구분이 없어 블로킹인지 아닌지 코드만 봐서는 모름.

### 운영 규칙 (코드 컨벤션)
```kotlin
// JPA/DB 조회는 반드시 IO Dispatcher에서 실행
suspend fun findShop(id: Long): Shop = withContext(Dispatchers.IO) {
    shopRepository.findById(id) ?: throw ShopNotFoundException(id)
}

// CPU 집약적 연산은 Default Dispatcher
suspend fun parseHtml(html: String): ParsedData = withContext(Dispatchers.Default) {
    // HTML 파싱 로직
}

// 외부 HTTP는 WebClient가 내부적으로 논블로킹 → Dispatcher 변경 불필요
suspend fun callExternalApi(shopId: Long): ExternalResponse {
    return webClient.get().uri("/shops/$shopId").retrieve().awaitBody()
}
```

### 이 결정이 틀렸다고 판단할 기준
- 팀 내 Java 개발자가 합류하는 경우 Virtual Threads로 전환 검토 (Kotlin 없이도 동일 효과)
- Spring Boot 4.x에서 Virtual Threads + Structured Concurrency가 안정화되는 경우 재평가

---

## 구현 결정 사항

| 설정 | 값 | 근거 |
|-----|---|-----|
| `Dispatchers.IO` | JPA/Redis 호출 시 | JPA는 블로킹 API, IO 스레드풀에서 처리 |
| `Dispatchers.Default` | CPU 집약 연산 | HTML 파싱, JSON 직렬화 등 |
| coroutine scope | `CoroutineScope(SupervisorJob())` | 자식 코루틴 실패가 형제 코루틴에 전파되지 않도록 |
| WebClient | awaitBody() 확장 함수 | Spring WebFlux의 코루틴 확장 활용 |

---

## 참고
- [Kotlin Coroutines 공식 문서](https://kotlinlang.org/docs/coroutines-overview.html)
- [Spring Coroutines 지원](https://docs.spring.io/spring-framework/docs/current/reference/html/languages.html#coroutines)
- [Virtual Threads vs Coroutines - Roman Elizarov (JetBrains)](https://medium.com/@elizarov/kotlin-coroutines-vs-project-loom-6e3b4cde17e3)
