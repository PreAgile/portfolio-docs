# 포트폴리오 실행 로드맵

> 이 문서는 3개 Repo를 어떤 순서로, 어떤 이슈로, 어떤 트레이드오프를 겪으며 만들어가는지 정의한다.
> STRATEGY.md가 "무엇을/왜"라면, 이 문서는 "어떤 순서로/어떻게"다.

---

## 전체 순서

```
Repo 1: concurrency-cache-lab ──── 약 4~6주
    ↓
Repo 2: kafka-outbox-pipeline ──── 약 4~6주
    ↓
Repo 3: resilience-patterns-lab ── 약 3~4주
```

---

## Repo 1: `concurrency-cache-lab`

**도메인**: 선착순 쿠폰 발급 / 재고 차감 시스템
**트랙**: Track 0 + Track 1 (동시성) + Track 3 (캐시)

### Milestones & Issues (12개)

#### Phase A: 인프라 + 기준선

| # | 제목 | 설명 |
|:-:|------|------|
| 1 | 프로젝트 셋업 (Spring Boot 3.x + Java 17) | 토큰 갱신 도메인 기본 API. `PUT /api/tokens/{id}/refresh` |
| 2 | 인프라 셋업 (docker-compose) | MySQL, Redis, Prometheus, Grafana, k6. 이 Repo 전용 인프라 |
| 3 | 기준선 측정 + 실험 템플릿 | Hello API k6 baseline TPS/P99 + 메트릭 정의 + 실험 기록 템플릿 |

#### Phase B: Track 1 — 동시성 & 분산 락

| # | 제목 | 유형 | 설명 |
|:-:|------|:----:|------|
| 4 | 락 없이 100 스레드 토큰 갱신 → lost update | 당해보기 | ExecutorService 100스레드 + CountDownLatch. 갱신 값 덮어쓰기 재현 |
| 5 | synchronized (단일 서버 → 2 인스턴스 무력화) | 당해보기+해결시도 | 단일 서버 정합성 OK → 2포트 동시 실행에서 무력화 증명 |
| 6 | DB FOR UPDATE 락 → 커넥션 병목 측정 | 해결시도 | 정합성 OK. TPS 감소 + DB 커넥션 점유 병목 체감 |
| 7 | Redisson 분산 락 구현 | 해결 | watchdog 자동 연장, 재진입, owner 관리. TPS + 정합성 최종 측정 |
| 8 | Track 1 종합: 락 방식별 비교표 | 정리 | experiments/ 문서. synchronized / DB FOR UPDATE / Redisson 실측 비교 |

#### Phase C: Track 3 — 캐시 & Stampede

| # | 제목 | 유형 | 설명 |
|:-:|------|:----:|------|
| 9 | 캐시 없이 부하 → @Cacheable → Stampede 재현 | 당해보기 | no cache 1000RPS + @Cacheable TTL 만료 시 DB 커넥션 급등 재현. #3 이후 시작 가능 |
| 10 | Stampede 해결: 분산 락 + Double-Check | 해결 | TTL 만료 시 DB 요청 1건만 발생 확인. #7 + #9 의존 |
| 11 | L1(Caffeine) + L2(Redis) 2계층 캐시 | 해결 | L1 TTL 5초 / L2 TTL 60초. 히트율 Micrometer 메트릭 |
| 12 | Track 3 종합: 캐시 전략별 비교표 | 정리 | experiments/ 문서. 4단계 실측 비교 + README Before/After |

**의존성 그래프**

```
#1 → #2 → #3
              ├→ #4 → #5 → #6 → #7 → #8
              │                   ↓
              └→ #9 ──→ #10 ←────┘
                         ↓
                        #11 → #12
```

### 트레이드오프 — AI와 나눌 대화

| # | 시점 | 질문 | 기대하는 판단 |
|:-:|:----:|------|-------------|
| 1 | #5 이후 | "synchronized 대신 ReentrantLock을 쓰면 분산 환경에서도 되나?" | 안 된다. JVM 락은 프로세스 범위. → 왜 분산 락이 필요한지 근거 |
| 2 | #6 이후 | "DB 락 커넥션 점유가 길어지면 어떤 문제?" | 커넥션 풀 고갈 → 다른 API도 영향. DB 락의 한계를 실측으로 증명 |
| 3 | #7 중 | "Redis 락 TTL을 몇 초로 잡아야 하나? 5초? 30초?" | 짧으면 좀비 락, 길면 장애 시 대기 증가. 정답 없음 → Redisson watchdog 필요성 |
| 4 | #7 이후 | "Redis가 죽으면 분산 락은? RedLock은?" | 단일 장애점 인지. RedLock 논쟁 (Kleppmann vs Antirez). 면접 대비 |
| 5 | #10 중 | "PER(Probabilistic Early Recomputation) vs 분산 락 Stampede 방지?" | PER은 확률적, 분산 락은 확정적. 도메인 요구사항에 따라 내가 선택 |
| 6 | #11 중 | "L1 TTL 1초/3초/5초 히트율 차이? 서버 간 불일치는?" | k6로 직접 비교. 5초간 불일치 허용 가능한지 도메인 판단 |

---

## Repo 2: `kafka-outbox-pipeline`

**도메인**: 주문 생성 → 이벤트 발행 → 소비 파이프라인
**트랙**: Track 0 + Track 2 (Kafka) + Track 5 (Outbox)

### Milestones & Issues

#### M0: 인프라

| # | 제목 | 설명 |
|:-:|------|------|
| 1 | Spring Boot + 주문(Order) 도메인 기본 API | `POST /api/orders` → Order 생성 |
| 2 | docker-compose (Kafka KRaft, MySQL, Prometheus, Grafana, Kafka UI, k6) | 이 Repo 전용 인프라 |
| 3 | Kafka 기본 동작 확인 | 토픽 생성, Producer/Consumer 기본 메시지 송수신 |

#### M1: Kafka 메시지 안정성 (Track 2)

| # | 제목 | 유형 | 설명 |
|:-:|------|:----:|------|
| 4 | auto-commit + kill -9 → 메시지 유실 | 당해보기 | enable.auto.commit=true. Consumer 처리 중 kill -9. 발행 수 vs 처리 수 비교 |
| 5 | manual commit → 유실 없음, 중복 발생 | 해결시도 | 커밋 전 재시작 시 중복 처리 확인. 중복된 메시지 수 측정 |
| 6 | manual commit + Idempotent Consumer | 해결 | processed_events 테이블. 유실 0 + 중복 0 확인 |
| 7 | Consumer 2개 → Rebalancing 중단 측정 | 실험 | Rebalancing 소요 시간, 처리 중단 구간 측정 |
| 8 | max.poll.records 튜닝 (50/100/200) | 실험 | 처리량 vs max.poll.interval.ms 위반 리스크 비교 |
| 9 | 메시지 안정성 Before/After 비교표 | 정리 | experiments/ 문서 |

#### M2: Outbox Pattern (Track 5)

| # | 제목 | 유형 | 설명 |
|:-:|------|:----:|------|
| 10 | 주문 저장 후 kafkaTemplate.send() → 크래시 유실 | 당해보기 | 발행 직전 RuntimeException 주입. DB에는 있고 Kafka에는 없음 |
| 11 | @Transactional로 묶기 시도 → 여전히 유실 | 당해보기 | Kafka는 DB 트랜잭션 밖. 구조적으로 원자적이지 않음을 확인 |
| 12 | Outbox 테이블 + Relay (스케줄러 폴링) | 해결 | 같은 트랜잭션에 Order + Outbox 저장. Relay가 폴링 → Kafka 발행 |
| 13 | Relay 다중 인스턴스 경합 | 실험 | Relay 2개 동시 실행. SELECT FOR UPDATE SKIP LOCKED로 중복 방지 |
| 14 | 폴링 주기 비교 (100ms / 1초 / 5초) | 실험 | DB CPU/커넥션 수 vs 발행 지연 트레이드오프 실측 |
| 15 | Outbox Before/After 비교표 | 정리 | experiments/ 문서 |

#### M3: 문서화

| # | 제목 | 설명 |
|:-:|------|------|
| 16 | README.md | 실험 요약, Before/After, 실행 방법 |
| 17 | deep-dive/ CS 원리 정리 | Kafka 커밋 로그, ISR, Rebalancing, 2PC 한계, Eventual Consistency |

### 트레이드오프 — AI와 나눌 대화

| # | 시점 | 질문 | 기대하는 판단 |
|:-:|:----:|------|-------------|
| 7 | #4 이후 | "auto-commit 주기를 1초로 줄이면 유실이 안 되지 않나?" | 줄긴 하지만 0은 아님. 구조적으로 못 막는다 → manual commit 필요 |
| 8 | #6 이후 | "Kafka Streams Exactly-once를 쓰면 되지 않나?" | Kafka→Kafka는 가능. Kafka→외부 DB는 트랜잭션 경계가 다름 → At-least-once + 멱등성 선택 |
| 9 | #7 중 | "파티션 3개 vs 10개?" | Consumer보다 적으면 유휴, 많으면 Rebalancing 비용. 직접 비교 실험 |
| 10 | #12 이후 | "Debezium(CDC) 쓰면 ms 단위인데 폴링 5초는 느리지 않나?" | Debezium: binlog connector 운영 복잡도. 5초 지연이 도메인에서 허용 가능한지 내가 판단 |
| 11 | #14 중 | "폴링 100ms면 초당 10번 SELECT인데 DB 부하 얼마나?" | 직접 측정. DB CPU/커넥션 수 비교 → ADR-005 근거 |
| 12 | #13 중 | "SKIP LOCKED가 없는 MySQL 5.x라면 대안은?" | advisory lock, 별도 큐 테이블 등. 대안을 아는 것 자체가 면접 포인트 |

---

## Repo 3: `resilience-patterns-lab`

**도메인**: 복수 외부 API 연동 서비스 (결제 API, 배송 API, 알림 API)
**트랙**: Track 0 + Track 4 (복원력)

### Milestones & Issues

#### M0: 인프라

| # | 제목 | 설명 |
|:-:|------|------|
| 1 | Spring Boot + 외부 API 연동 서비스 | 결제/배송/알림 3개 외부 클라이언트. 내부 `/api/orders/{id}/process` |
| 2 | WireMock 외부 API 시뮬레이션 | 정상 (200, 50ms) / 지연 (200, 3초) / 에러 (500) 시나리오 |
| 3 | docker-compose (Prometheus, Grafana, k6) | 이 Repo 전용 인프라 |

#### M1: 장애 전파 & Circuit Breaker (Track 4)

| # | 제목 | 유형 | 설명 |
|:-:|------|:----:|------|
| 4 | CB 없이 외부 3초 지연 → 내부 전체 P99 전파 | 당해보기 | WireMock 결제 API를 3초 지연으로. 내부 전체 P99가 3초가 되는 것 확인 |
| 5 | 스레드 풀 고갈 → 정상 API도 응답 불가 | 당해보기 | 100 RPS 부하. 배송/알림 API는 정상인데 스레드 풀이 결제 대기에 점유 → 전부 응답 불가 |
| 6 | Resilience4j Circuit Breaker 적용 | 해결 | failureRateThreshold=50. Open 시 Fallback. 정상 API P99 복원 확인 |
| 7 | failureRateThreshold 30/50/70 비교 | 실험 | 각 값에서 Open 전환 시점, 오탐(정상인데 Open) 비율 비교 |
| 8 | Bulkhead 스레드 풀 격리 | 해결 | 결제 API 전용 스레드 풀 10개. 장애 시에도 배송/알림 스레드 풀 정상 확인 |
| 9 | Retry + 지수 백오프 | 실험 | 멱등 API(GET 배송 상태)에만 Retry. 비멱등 API에 Retry 시 중복 호출 재현 |
| 10 | Rate Limiting — Token Bucket vs Fixed Window | 실험 | 외부 API 호출 제한. 버스트 허용 vs 균일 분배 차이 비교 |
| 11 | Half-Open → 점진적 복구 시나리오 | 실험 | 외부 장애 복구 후 CB가 자동으로 Closed 전환. 복구 소요 시간 측정 |

#### M2: 문서화

| # | 제목 | 설명 |
|:-:|------|------|
| 12 | README.md | 실험 요약, Before/After, 실행 방법 |
| 13 | deep-dive/ CS 원리 정리 | Circuit Breaker 상태 머신, Bulkhead, Token Bucket, 지수 백오프 |

### 트레이드오프 — AI와 나눌 대화

| # | 시점 | 질문 | 기대하는 판단 |
|:-:|:----:|------|-------------|
| 13 | #7 중 | "failureRateThreshold를 50으로 한 근거는?" | 30/50/70 실험 데이터 비교. 도메인별 민감도가 다름을 이해 |
| 14 | #8 중 | "스레드 풀 격리 vs 세마포어 격리 차이?" | 스레드 풀: 완전 격리+오버헤드. 세마포어: 가벼움+같은 스레드. Virtual Thread에서는? |
| 15 | #9 중 | "POST /payments에 Retry 걸면?" | 비멱등 → 중복 결제! Retry 전제 = 멱등성. WireMock으로 직접 재현 |

---

## 이슈 작성 템플릿

각 Repo에서 이슈를 만들 때 이 형식을 사용한다:

```markdown
## 가설
(무엇을 확인하려는가)

## 실험 방법
1. (구체적 단계)
2. ...

## 예상 결과
(어떤 결과가 나올 것으로 예상하는가)

## 실제 결과
(구현 후 채우기 — 수치 포함)

## 발견
(예상과 달랐던 점, 새로 배운 것)

## 면접 한 줄
(이 실험으로 면접에서 말할 수 있는 것)
```

---

## 커밋 패턴

```
feat(concurrency): 락 없이 100스레드 동시 요청 시 초과 발급 재현

- 가설: read-modify-write가 원자적이지 않아 데이터 불일치 발생
- 결과: issuedQty=100 기대, 실측 issuedQty=137 (37건 초과)
- 다음: synchronized 적용 후 단일 서버에서 재실험

Closes #4
```

---

## AI와 나눌 대화 15개 — 전체 요약

| # | Repo | 시점 | 질문 | 얻는 것 |
|:-:|:----:|:----:|------|--------|
| 1 | 1 | M1 #6 후 | synchronized가 분산에서 왜 안 되나? | JVM 락 범위 이해 |
| 2 | 1 | M1 #7 후 | DB 락 커넥션 점유가 왜 위험한가? | DB 병목 이해 |
| 3 | 1 | M1 #8 중 | Redis 락 TTL을 몇 초로 잡아야 하나? | 좀비 락 문제 체감 |
| 4 | 1 | M1 #9 후 | Redis 죽으면 분산 락은? RedLock은? | 단일 장애점 대응 |
| 5 | 1 | M2 #13 중 | PER vs 분산 락 Stampede 방지? | 캐시 전략 깊이 |
| 6 | 1 | M2 #14 중 | L1 TTL 1초/3초/5초 히트율 차이? | 실측으로 설정값 근거 |
| 7 | 2 | M1 #4 후 | auto-commit 주기 줄이면 유실 안 되나? | 구조적 한계 이해 |
| 8 | 2 | M1 #6 후 | Exactly-once를 쓰면 되지 않나? | 외부 DB 원자성 한계 |
| 9 | 2 | M1 #7 중 | 파티션 3개 vs 10개? | Rebalancing 비용 체감 |
| 10 | 2 | M2 #12 후 | Debezium vs 폴링 트레이드오프? | 인프라 복잡도 판단 |
| 11 | 2 | M2 #14 중 | 폴링 100ms면 DB 부하 얼마나? | 실측 근거 |
| 12 | 2 | M2 #13 중 | SKIP LOCKED 없으면 대안은? | 대안 지식 |
| 13 | 3 | M1 #7 중 | failureRateThreshold 왜 50? | 실험 기반 설정값 |
| 14 | 3 | M1 #8 중 | 스레드 풀 vs 세마포어 Bulkhead? | 격리 수준 트레이드오프 |
| 15 | 3 | M1 #9 중 | 비멱등 API에 Retry 걸면? | Retry 전제 조건 |

---

_마지막 업데이트: 2026-04-14_
