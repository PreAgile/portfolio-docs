# 백엔드 포트폴리오 전략 문서

> **목적**: 실제 운영 경험(TypeScript/Python)을 Java/Kotlin 기반으로 재설계하여,
> 네이버/카카오/토스/쿠팡/당근마켓 수준의 백엔드 포트폴리오를 구성한다.

---

## 핵심 원칙

### 1. AI를 도구로, 판단은 내가
모든 기술 결정은 다음 순서를 따른다.

```
1. 문제 정의 (내가)
2. 대안 탐색 (AI + 공식 문서)
3. 트레이드오프 분석 (내가 + AI 검증)
4. 결정 + 근거 문서화 (ADR 작성)
5. 구현 (내가 + AI 보조)
6. 검증 및 측정 (내가)
```

AI한테 "어떻게 구현해?"가 아니라 "내가 A를 선택하려는데 B 대비 어떤 리스크가 있어?"를 물어야 한다.

### 2. 실제 문제 기반 설계
회사 코드를 공개할 수 없지만, **실제 운영에서 겪은 문제 패턴**은 포트폴리오의 출발점이 된다.

| 실제 이슈 (회사) | 포트폴리오에서 재현할 문제 | 기술적 해결책 |
|----------------|------------------------|------------|
| 로그 버퍼 누락으로 플랫폼 데이터 잘림 (cmong-mq #394) | 대용량 이벤트 처리 중 메시지 유실 | Kafka + Outbox Pattern |
| 토큰 값이 덮어씌워지는 동시성 버그 (cmong-mq #388) | 동시 요청에서 공유 자원 경합 | Redis 분산락 (Redisson) |
| 중복 에러 처리 (cmong-mq Fix duplicate error) | Consumer 재시작 시 메시지 중복 처리 | Idempotent Consumer |
| soft-delete된 shop 필터 누락 (cmong-mq #383) | 복잡한 도메인 규칙이 서비스 전반에 산재 | DDD + 도메인 레이어 분리 |
| 크롤러 토큰 없는 경우 처리 부재 (cmong-mq #387) | 외부 API 장애 시 시스템 전파 | Circuit Breaker + Fallback |

### 3. 측정 가능한 수치로만 어필
```
❌ "고성능 시스템 구현"
❌ "로컬에서 100만 TPS 달성"
✅ "MacBook M3, Docker Compose 환경, k6 부하테스트 기준
    캐시 히트율 80% 조건에서 8,500 TPS, P99 15ms 달성
    병목: HikariCP 커넥션 풀 (50 → 100 조정 후 11,200 TPS)"
```

---

## 프로젝트 구성 (2+1개)

> 피드백 반영: Project 1과 2를 분리하면 Outbox Pattern의 핵심 장면(같은 트랜잭션 안에서 DB 저장 + Outbox 이벤트 저장)을 보여줄 수 없음. 아래 구조로 재설계.

### 전체 흐름 (한 눈에)

```
[platform-api]                        [async-crawler]
 - 가게/리뷰 도메인 API                  - 플랫폼 크롤링
 - DB 저장 + Outbox 이벤트 저장          - 중복 URL 필터 (Bloom Filter)
 - Redis 분산락 (동시성)                 - Rate Limiting
 - Circuit Breaker (외부 API)           - Spring Batch 재시도
        |
        | Kafka (Outbox Relay가 폴링 → 발행)
        v
 [platform-event-consumer]
  - 이벤트 소비 (Idempotent)
  - Dead Letter Queue 처리
  - Consumer Lag 모니터링
```

---

### Project 1: platform-api
**원본 영감**: cmong-be (TypeScript + NestJS) + cmong-mq의 동시성 이슈

**도메인**: 리뷰 플랫폼 API (가게 등록, 리뷰 수집, 댓글 자동 등록)
- 단순 CRUD가 아닌 실제 비즈니스 규칙이 있는 도메인을 선택
- "soft-delete된 가게는 크롤링에서 제외", "토큰이 없는 가게는 API 호출 차단" 등 실운영 규칙 재현

**해결하는 문제**:
- 동시 요청에서 토큰/세션 덮어쓰기 버그 → Redis 분산락
- 외부 크롤링 API 장애 시 전체 서비스 응답 지연 → Circuit Breaker
- 크롤링 결과 이벤트 발행 유실 → Transactional Outbox Pattern
- 트래픽 급증 시 DB 커넥션 고갈 → HikariCP 튜닝

**핵심 구현 요소**:
- Kotlin + Spring Boot 3.x
- Transactional Outbox Pattern (DB 저장 + Outbox 같은 트랜잭션)
- Outbox Relay (별도 스케줄러가 폴링 → Kafka 발행)
- Redis 분산락 (Redisson) + Cache-Aside + Stampede 방지
- Circuit Breaker (Resilience4j) + Fallback
- GlobalExceptionHandler + 에러 코드 체계
- SpringDoc (OpenAPI 3.0) 문서화

**테스트 전략**:
- Testcontainers: MySQL + Redis + Kafka 통합 테스트
- 동시성 테스트: 100 스레드 동시 요청 시 데이터 정합성 검증
- Circuit Breaker 테스트: 외부 API 장애 시 Fallback 동작 검증

---

### Project 2: platform-event-consumer
**원본 영감**: cmong-mq (Python + RabbitMQ) → Kafka Consumer로 재설계

**해결하는 문제**:
- Consumer 재시작 시 메시지 유실 → Manual Commit + Idempotent Consumer
- 중복 처리로 인한 DB 데이터 중복 → processed_events 테이블
- 처리 실패한 메시지 방치 → Dead Letter Queue + 재처리 전략
- Consumer Lag 급증 시 인지 불가 → Micrometer + Grafana 모니터링

**핵심 구현 요소**:
- Kotlin + Spring Boot 3.x + Spring Kafka
- Idempotent Consumer (processed_events 테이블로 중복 처리 방지)
- Dead Letter Topic + 재처리 스케줄러
- Consumer Lag 메트릭 (Micrometer → Prometheus → Grafana)
- `enable.auto.commit=false` + Manual Commit

**테스트 전략**:
- Testcontainers: Kafka 통합 테스트
- 멱등성 테스트: 동일 메시지 3회 발행 시 DB에 1건만 저장되는지 검증
- 재처리 테스트: DLT 메시지가 최종적으로 처리되는지 검증

---

### Project 3: async-crawler
**원본 영감**: cmong-scraper-js (TypeScript)

**해결하는 문제**:
- 동일 URL 중복 크롤링 자원 낭비 → Redis Bloom Filter
- Rate Limit 초과로 IP 차단 → Bucket4j Rate Limiting
- 크롤링 실패 시 재시도 전략 부재 → Spring Batch Chunk + Retry

**핵심 구현 요소**:
- Kotlin Coroutines + Spring WebClient 비동기 HTTP
- Redis Bloom Filter 중복 URL 체크
- Bucket4j Rate Limiting (토큰 버킷 알고리즘)
- Spring Batch: Chunk 기반 처리 + Retry Policy
- 크롤링 결과 → platform-api로 HTTP 전달 (또는 직접 Kafka 발행)

**테스트 전략**:
- Testcontainers: Redis 통합 테스트
- Bloom Filter 정확도 테스트: False Positive Rate 측정
- Rate Limiting 테스트: 설정된 RPS 초과 시 요청이 거부되는지 검증

---

## ADR (Architecture Decision Records)

각 기술 결정마다 다음 형식으로 문서화.

```
docs/adr/ADR-NNN-[주제].md
```

### ADR 작성 기준
- AI에게 물어본 내용 + AI 답변 요약 포함
- 내가 최종 결정한 근거 명시
- 선택하지 않은 대안과 그 이유 (기술적 이유만)
- 이 결정이 틀렸다고 판단할 기준

| ADR | 상태 | 주제 |
|-----|------|------|
| ADR-001 | 완료 | Kafka vs RabbitMQ |
| ADR-002 | 완료 | Kotlin Coroutines vs Virtual Threads |
| ADR-003 | 완료 | Cache 전략 (Cache-Aside + Stampede 방지) |
| ADR-004 | 예정 | Idempotent Consumer 구현 방식 |
| ADR-005 | 예정 | Outbox Relay 폴링 주기 결정 |

---

## GitHub 공개 전략

### 리포지토리 구조
```
github.com/[username]/
├── platform-api              # Spring Boot + Outbox + Redis + Circuit Breaker
├── platform-event-consumer   # Kafka Consumer + Idempotent + DLT
├── async-crawler             # Coroutines + Bloom Filter + Batch
└── portfolio-docs            # ADR, 벤치마크 결과, 아키텍처 다이어그램
```

> 프로젝트 이름에서 회사 코드네임(cmong) 제거. "회사 코드 공개?" 오해 방지.

### README 필수 항목
1. **왜 만들었는가** (실제 운영 문제 → 해결 필요성)
2. **무엇을 결정했는가** (ADR 링크)
3. **어떻게 측정했는가** (k6 결과 + 수치)
4. **무엇이 아직 부족한가** (한계점 - 신뢰도 UP)

### 커밋 전략
Conventional Commits 형식 준수:
```
feat(kafka): Transactional Outbox Pattern 구현

- ShopService에서 DB 저장과 이벤트 발행을 같은 트랜잭션으로 묶음
- Outbox 테이블 polling 주기: 100ms (ADR-005 참고)
- 이전 방식(직접 Kafka 발행)의 문제: DB 저장 후 Kafka 발행 전 크래시 시 유실

Closes #12
```

### GitHub Actions CI (필수)
```yaml
# .github/workflows/ci.yml
- 트리거: main 브랜치 PR
- 단계: 빌드 → 테스트 (Testcontainers) → 린트
- 목표: PR마다 통합 테스트 자동 실행
```

---

## 학습 로드맵

### Phase 1 - Spring/JPA/Kotlin 기반 이해 (1~2주)
- [ ] Spring IoC/DI 동작 원리 (단순 사용이 아닌 프록시 메커니즘까지)
- [ ] @Transactional 내부 동작 (self-invocation 문제 포함)
- [ ] JPA 1차 캐시, 지연 로딩, N+1 문제 해결 전략
- [ ] Kotlin: data class, sealed class, extension function 실전 활용
- [ ] Kotlin Coroutines 내부 동작 (ADR-002 작성과 함께)

### Phase 2 - Kafka + 테스트 심화 (1~2주)
- [ ] Consumer Group, Partition, Offset 내부 동작
- [ ] Rebalancing 발생 조건과 영향 + max.poll.interval.ms 의미
- [ ] Exactly-once vs At-least-once 선택 기준
- [ ] **Testcontainers로 Kafka 통합 테스트 작성** ← 핵심
- [ ] JUnit 5 + MockK (Kotlin 테스트 표준)

### Phase 3 - 구현 + 측정 (2~4주)
- [ ] Project 1 (platform-api) 구현
  - [ ] Outbox Pattern + Testcontainers 통합 테스트 통과
  - [ ] 분산락 동시성 테스트 (100 스레드 동시 요청)
  - [ ] Circuit Breaker Fallback 테스트
- [ ] Project 2 (platform-event-consumer) 구현
  - [ ] Idempotent Consumer 멱등성 테스트 통과
  - [ ] DLT 재처리 테스트 통과
  - [ ] Grafana Consumer Lag 대시보드 스크린샷 확보
- [ ] Project 3 (async-crawler) 구현
  - [ ] Bloom Filter False Positive Rate 측정
  - [ ] Rate Limiting 동작 확인
- [ ] k6 부하테스트 + 병목 분석 (각 프로젝트)

### Phase 4 - 문서화 + CI (1주)
- [ ] ADR-004, ADR-005 작성
- [ ] GitHub Actions CI 파이프라인 구성
- [ ] 각 프로젝트 README 완성 (수치 포함)
- [ ] 기술 블로그 포스팅 1~2개

---

## 면접 대비 - 예상 질문 & 답변 준비

| 질문 | 답변의 소재 |
|------|-----------|
| "Kafka를 선택한 이유가 뭔가요?" | ADR-001 |
| "Coroutines vs Virtual Threads 차이는?" | ADR-002 |
| "Outbox Pattern은 왜 썼나요?" | ADR-005 + 실제 유실 케이스 설명 |
| "@Transactional self-invocation 알고 있나요?" | Phase 1 학습 내용 |
| "분산락이 없으면 어떻게 되나요?" | Project 1의 동시성 테스트 코드로 증명 |
| "TPS 8,500이라고 하셨는데 어떻게 측정하셨나요?" | k6 스크립트 + 환경 스펙 |
| "Consumer Lag 어떻게 모니터링하나요?" | Project 2의 Grafana 대시보드 |
| "Testcontainers를 왜 썼나요?" | "Mock 대신 실제 Kafka/Redis와 테스트 → 환경 차이로 인한 버그 사전 방지" |

---

## 다음 액션

- [x] `docs/adr/ADR-001-kafka-vs-rabbitmq.md` 작성 (2026-04-03)
- [x] `docs/adr/ADR-002-coroutines-vs-virtual-threads.md` 작성 (2026-04-03)
- [x] `docs/adr/ADR-003-cache-strategy.md` 작성 (2026-04-03)
- [x] Docker Compose 로컬 환경 구성 (Kafka KRaft, Redis, MySQL, Prometheus, Grafana, k6)
- [x] `projects/infra/mysql/init.sql` 생성
- [ ] `docker-compose up -d` 실행 후 모든 서비스 healthy 확인
- [ ] `projects/platform-api/` Spring Boot 뼈대 생성 (Spring Initializr)
- [ ] Testcontainers 기반 첫 Kafka 통합 테스트 통과
- [ ] `LEARNING-LOG.md` 작성 시작

---

_이 문서는 포트폴리오 진행에 따라 지속적으로 업데이트한다._
_마지막 업데이트: 2026-04-03 (FEEDBACK.md 기반 전면 개정)_
