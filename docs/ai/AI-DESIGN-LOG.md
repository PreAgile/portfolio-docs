# AI 설계 협업 로그

> **목적**: 설계 문제가 주어졌을 때 AI를 어떻게 도구로 활용했는지를 기록한다.
> "AI가 결정했다"가 아니라 "내가 문제를 정의하고, AI로 검증하고, 내가 판단했다"를 증명한다.
>
> **형식**: 문제 정의 → AI에게 던진 질문 → AI 답변 요약 → 내 판단 → 최종 결정
>
> **작성일**: 2026-04-11

---

## 사용 원칙

```
내가 한다                          AI가 돕는다
─────────────────────────────      ─────────────────────────────
문제 정의                          대안 탐색
트레이드오프 최종 판단              "A vs B 트레이드오프 분석"
ADR 작성                          초안 작성 보조
테스트 시나리오 설계               엣지 케이스 제안
코드 라인별 이해 확인              구현 (내가 설계한 것)
```

**AI를 쓰는 올바른 방식**

```
❌ "Outbox Pattern 구현해줘"
✅ "내가 Outbox Relay 폴링 주기를 100ms로 설정하려는데,
    DB 부하 관점에서 어떤 리스크가 있어? 대안이 있어?"

❌ "Kafka 설정해줘"
✅ "max.poll.records를 100으로 설정한 이유가
    '처리 시간 × 100 < max.poll.interval.ms'인데,
    이 계산이 맞는지, 놓친 게 있는지 검증해줘"
```

---

## Log #001: Kafka vs RabbitMQ 선택 (ADR-001)

**날짜**: 2026-03-28

### 문제 정의 (내가)

> "메시지 재처리 시나리오에서 Consumer A가 메시지를 처리하다 실패했을 때,
> Consumer B가 처음부터 다시 처리할 수 있어야 한다.
> RabbitMQ는 ACK 전에 메시지를 삭제하지 않는데, Kafka가 이게 더 자연스럽다고 하는데 맞나?"

### AI에게 던진 질문

```
RabbitMQ에서 Consumer Group 개념이 없다는 게 구체적으로 어떤 문제를 만드는지 설명해줘.
내가 생각한 시나리오:
- Consumer A가 죽으면 메시지는 다시 Queue에 들어감
- Consumer B가 처리 가능
그런데 이게 "독립적으로 각자 다 처리"와 다른 거잖아.
이 차이를 구체적인 예시로 설명해줘.
```

### AI 답변 요약

```
RabbitMQ의 경쟁적 소비(Competing Consumers):
- Queue에서 메시지를 꺼내면 해당 메시지는 사라짐
- Consumer A, B가 있으면 메시지를 나눠가짐 (분산 처리)
- 같은 메시지를 A, B 모두 처리하려면 별도 Queue 필요 (Exchange → Fanout)

Kafka Consumer Group:
- 파티션 할당: Partition 0 → Consumer A, Partition 1 → Consumer B
- Consumer A가 죽으면 리밸런싱: Partition 0 → Consumer B
- 다른 Consumer Group이 있으면 각자 독립적으로 오프셋 관리
- 즉, "대시보드 집계 서비스"와 "알림 서비스"가 같은 이벤트를 독립적으로 처리 가능
```

### 내 판단

AI 설명이 맞음. 핵심 차이:
- RabbitMQ: 메시지 소비 = 삭제 (1:1 or Fanout 명시 필요)
- Kafka: 메시지 소비 = 오프셋 이동 (원본 유지, 여러 Consumer Group이 각자 읽기)

우리 시스템에서 "payment-completed 이벤트를 대시보드 집계와 알림 서비스가 모두 처리"하는 요건 → Kafka가 더 자연스럽다.

그런데 AI가 놓친 부분이 있었음: Kafka의 **파티션 키 선택** 문제. 같은 ShopId의 이벤트가 다른 파티션에 가면 순서 보장 안 됨 → `shopId`를 파티션 키로 사용해야 함.

### 최종 결정: Kafka 선택

근거: Consumer Group 독립성, 재처리 용이성, 오프셋 기반 재소비
→ ADR-001로 문서화

**배운 것**: AI는 큰 그림은 잘 설명했지만, 파티션 키 선택 같은 실무 디테일은 내가 추가로 발굴해야 했음.

---

## Log #002: Cache Stampede 방지 전략 (ADR-003)

**날짜**: 2026-03-30

### 문제 정의 (내가)

> "배치 작업이 완료된 직후, 수십만 Shop의 캐시가 동시에 만료된다.
> 그 순간 수천 개의 요청이 모두 DB를 때리는 Stampede가 발생한다.
> `@Cacheable(sync=true)`만으로는 다중 인스턴스 환경에서 불충분한데,
> Redisson으로 분산 락을 추가하는 것이 맞는 방향인가?"

### AI에게 던진 질문 1 (검증)

```
sync=true의 동작을 정확히 설명해줘.
내가 이해한 것: "같은 JVM 내에서 동일 캐시 키에 대한 요청을 직렬화한다"
이게 맞나? 그리고 다중 인스턴스에서는?
```

**AI 답변 요약**

```
sync=true:
- Spring Cache Abstraction 레벨에서 synchronized 블록으로 감쌈
- 같은 JVM, 같은 캐시 키에 대해서만 직렬화
- 다중 인스턴스(Pod 10개)에서는 효과 없음
- 각 인스턴스가 동시에 DB 조회 가능
```

→ 내 이해 맞음. 다음 단계로.

### AI에게 던진 질문 2 (대안 탐색)

```
다중 인스턴스 Stampede 방지 방법을 3가지로 정리해줘.
각 방법의 트레이드오프를 다음 기준으로:
1. 구현 복잡도
2. 락 경합 시 추가 지연
3. 락 보유 중 JVM 크래시 대응
```

**AI 답변 요약**

```
Option A: Probabilistic Early Expiration
- 만료 10% 전부터 확률적으로 미리 갱신
- 장점: 락 없음, 지연 없음
- 단점: 동시에 여러 인스턴스가 갱신 가능 (완벽한 Stampede 방지 아님)

Option B: Redis SETNX + Lua Script
- 락 획득 인스턴스만 DB 조회, 나머지는 대기 후 캐시에서 읽기
- 장점: 저수준 제어 가능
- 단점: Lua script 직접 작성, TTL 관리 복잡

Option C: Redisson RLock
- tryLock + watchdog (JVM 크래시 시 자동 만료)
- 장점: 검증된 라이브러리, watchdog으로 좀비 락 방지
- 단점: Redis 의존성 추가, 약간의 오버헤드
```

### 내 판단

AI가 Option A(Probabilistic)를 좋게 설명했지만 내 상황에는 맞지 않음:
- 배치 완료 시점에 **동시에** 대량 캐시가 만료되는 패턴
- Probabilistic은 분산된 만료에는 효과적이지만, 동시 대량 만료에는 여전히 문제

Option B vs C:
- Lua script 직접 작성 = 테스트가 어렵고, 락 TTL 계산 실수 가능
- Redisson = 이미 검증된 구현, watchdog = JVM 크래시 대응 자동화
- 선택: Redisson (구현 안전성 > 성능 미세 차이)

**AI가 놓친 것**: Double-Check 패턴 (락 획득 후 다시 캐시 확인) — 락 대기 중 다른 인스턴스가 이미 캐시를 채웠을 수 있음. 이건 내가 ADR에 추가.

### 최종 결정

Caffeine(L1) + Redis(L2) + Redisson Lock + Double-Check 패턴
→ ADR-003으로 문서화

---

## Log #003: Coroutines vs Virtual Threads 선택 (ADR-002)

**날짜**: 2026-04-01

### 문제 정의 (내가)

> "async-crawler에서 외부 API를 수백 개 동시 호출해야 한다.
> Kotlin Coroutine과 Java Virtual Thread(Loom) 둘 다 IO를 효율적으로 처리하는데,
> 어떤 기준으로 선택해야 하나?
> 특히 JPA를 쓰는 platform-event-consumer에서 JPA의 블로킹 API가 문제가 되는가?"

### AI에게 던진 질문

```
Kotlin Coroutine에서 JPA를 쓸 때 주의사항을 설명해줘.
내 예상: JPA는 블로킹 API이므로 Coroutine의 이점이 사라질 것 같다.
해결책은 withContext(Dispatchers.IO)인가?
그리고 Virtual Thread는 이 문제가 없는 건가?
```

**AI 답변 요약**

```
Coroutine + JPA 문제:
- JPA EntityManager는 Thread-Local 기반
- Coroutine은 여러 스레드에서 실행 가능 → Thread-Local 값 유실 위험
- 해결: withContext(Dispatchers.IO)로 JPA 블록을 IO 스레드풀에 고정

Virtual Thread + JPA:
- Virtual Thread도 Thread-Local 있음 (각 VT는 독립적 Thread-Local)
- JPA의 "synchronized 코드 블록"이 있으면 VT Pinning 발생
- Pinning: VT가 실행 중인 캐리어 스레드를 점유 → IO 이점 사라짐
- Hibernate의 일부 코드에 synchronized 있음 (JPA 구현 의존)
```

### 내 판단

AI 답변에서 핵심: **둘 다 JPA 블로킹 문제를 완전히 해결하진 못함**.

그런데 선택 기준이 다름:
- `withContext(Dispatchers.IO)`: 컴파일 타임에 IO 코드 명시 → 코드 리뷰에서 "이 코드는 IO다"가 보임
- VT: 암묵적 처리 → Pinning 버그 추적이 어려움 (`-Djdk.tracePinnedThreads=full` 필요)

**팀 학습 관점**: Kotlin Coroutine은 suspend 함수가 "이 코드는 중단 가능"을 명시 → 새 팀원이 코드를 봤을 때 의도가 명확.

**AI가 잘 설명한 것**: Pinning 개념과 Dispatchers.IO의 역할
**내가 추가한 것**: "코드 명시성"이라는 팀 협업 관점 → ADR에 반영

### 최종 결정

Kotlin Coroutines 선택 (Structured Concurrency + 명시적 중단 포인트)
→ ADR-002로 문서화

---

## Log #004: Transactional Outbox Relay 주기 (ADR-005 사전 검토)

**날짜**: 2026-04-05

### 문제 정의 (내가)

> "Outbox Relay 폴링 주기를 얼마로 설정해야 하나?
> 100ms면 DB에 초당 10회 SELECT 발생. 5초면 이벤트 지연이 최대 5초.
> 트레이드오프를 어떻게 계산해야 하나?"

### AI에게 던진 질문

```
MySQL에서 SELECT FOR UPDATE SKIP LOCKED 쿼리가
초당 10회 실행될 때 예상 부하를 알려줘.
테이블 크기: 1만 건 (처리 완료된 것은 별도 아카이빙)
인덱스: (status, created_at) 복합 인덱스
예상 결과 건수: 보통 0~5건

그리고 CDC(Debezium)와 폴링 방식의 트레이드오프를 비교해줘.
```

**AI 답변 요약**

```
폴링 부하 추정:
- 1만 건, 인덱스 있음, 0~5건 결과: 실행 시간 1~5ms 예상
- 초당 10회 × 5ms = 50ms/초 (DB 활용률 5% 수준)
- 허용 가능한 수준

CDC(Debezium) vs 폴링:
폴링:
- 장점: Spring 내장, 운영 단순
- 단점: 최대 폴링 주기만큼 지연, DB에 주기적 부하

CDC:
- 장점: 변경 즉시 감지 (지연 ~ms), DB 부하 없음
- 단점: 별도 Connector 운영, MySQL binlog 설정 필요, 운영 복잡도 높음
```

### 내 판단

AI의 부하 추정은 참고 수준 (실제 측정 필요). 하지만 오더 오브 매그니튜드는 맞음.

CDC 선택을 검토했지만:
- 포트폴리오 단계에서 Debezium 운영 복잡도 = 핵심 주제를 흐릴 수 있음
- 5초 지연 = 허용 가능한 SLA (대시보드 집계는 실시간 아님)
- 재검토 기준: 결제 완료 후 이벤트 지연이 1초 이내 요구 시

**결정**: 폴링 방식, 5초 주기 → ADR-005 작성 예정

**AI가 못 한 것**: 실제 MySQL 서버 환경 변수(innodb_lock_wait_timeout 등)를 고려한 정확한 수치 제공. 실측 필요.

---

## Log 양식 (새 설계 결정 시 복사해서 사용)

```markdown
## Log #XXX: [주제]

**날짜**: YYYY-MM-DD

### 문제 정의 (내가)

> "..."

### AI에게 던진 질문

```
...
```

### AI 답변 요약

```
...
```

### 내 판단

- AI가 맞은 것:
- AI가 놓친 것:
- 내가 추가한 것:

### 최종 결정

→ ADR-XXX로 문서화
```
