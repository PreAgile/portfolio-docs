# 포트폴리오 프로젝트 목록

각 프로젝트는 독립적인 GitHub 리포지토리로 공개한다.
회사 코드(TypeScript/Python)는 공개하지 않으며, **실제 운영에서 겪은 문제 패턴을 재설계한 것**임을 명시한다.

---

## 전체 구조

```
                    [platform-api]
                    ┌──────────────────────────────┐
  사용자 요청 ──────▶│  Spring Boot 3.x + Kotlin    │
                    │  - 가게/리뷰 도메인 API         │
                    │  - Transactional Outbox       │
                    │  - Redis 분산락               │
                    │  - Circuit Breaker            │
                    └───────────┬──────────────────┘
                                │ Kafka (Outbox Relay)
                                ▼
                    [platform-event-consumer]
                    ┌──────────────────────────────┐
                    │  Spring Kafka + Kotlin        │
                    │  - Idempotent Consumer        │
                    │  - Dead Letter Queue          │
                    │  - Consumer Lag 모니터링       │
                    └──────────────────────────────┘

[async-crawler]  ──────────────────────────────────────▶  platform-api (결과 전달)
 - Kotlin Coroutines
 - Bloom Filter 중복 제거
 - Rate Limiting
 - Spring Batch 재시도
```

---

## 프로젝트 1: platform-api
**상태**: 계획 중
**GitHub**: (예정)

**연결된 실제 운영 문제**:
- 동시 요청에서 토큰 값 덮어쓰기 (cmong-mq #388)
- 외부 크롤링 API 장애 시 전체 지연 (cmong-mq #387)
- DB 저장 후 이벤트 발행 전 크래시 시 유실

**핵심 기술**:
- Kotlin + Spring Boot 3.x
- Transactional Outbox Pattern
- Redis 분산락 (Redisson) + Cache Stampede 방지
- Circuit Breaker (Resilience4j)

**테스트 목표**:
- Testcontainers: MySQL + Redis + Kafka 통합 테스트
- 동시성 테스트: 100 스레드 동시 요청 시 데이터 정합성
- k6: P95 < 200ms, 에러율 < 1%

**폴더**: `./platform-api/` (예정)

---

## 프로젝트 2: platform-event-consumer
**상태**: 계획 중
**GitHub**: (예정)

**연결된 실제 운영 문제**:
- Consumer 재시작 시 메시지 처리 중 유실
- 중복 처리로 DB 데이터 중복 저장 (Fix duplicate error)
- 처리 실패 메시지 방치

**핵심 기술**:
- Kotlin + Spring Boot 3.x + Spring Kafka
- Idempotent Consumer (processed_events 테이블)
- Dead Letter Topic + 재처리 전략
- Micrometer + Prometheus + Grafana (Consumer Lag)

**테스트 목표**:
- 멱등성: 동일 메시지 3회 발행 시 DB에 1건만 저장
- DLT: 실패 메시지 최종 처리 검증

**폴더**: `./platform-event-consumer/` (예정)

---

## 프로젝트 3: async-crawler
**상태**: 계획 중
**GitHub**: (예정)

**연결된 실제 운영 문제**:
- 동일 URL 중복 크롤링 자원 낭비
- Rate Limit 초과로 IP 차단 이슈
- 크롤링 실패 시 재시도 전략 부재

**핵심 기술**:
- Kotlin Coroutines + Spring WebClient
- Redis Bloom Filter 중복 URL 체크
- Bucket4j Rate Limiting
- Spring Batch Chunk + Retry Policy

**폴더**: `./async-crawler/` (예정)

---

## 공통 인프라
**폴더**: `./infra/`

로컬 개발 환경 (docker-compose.yml):
- Kafka (KRaft 모드, Zookeeper 없음)
- Redis
- MySQL
- Prometheus + Grafana
- k6 (부하테스트)
- Kafka UI

**실행**:
```bash
cd infra
docker-compose up -d
# Kafka UI: http://localhost:8989
# Grafana: http://localhost:3000 (admin/admin)
# Prometheus: http://localhost:9090
```
