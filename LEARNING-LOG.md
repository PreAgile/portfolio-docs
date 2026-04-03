# 학습 일지

> 포트폴리오 구현 과정에서 배운 것들을 기록한다.
> 이 파일은 기술 블로그 포스팅의 초안 역할도 한다.
> 형식: 날짜 / 배운 것 / 직접 확인한 것 / 아직 모르는 것

---

## 작성 가이드

```
### YYYY-MM-DD

**오늘 배운 것**: (개념 설명)
**직접 확인한 것**: (코드/테스트로 증명한 것)
**아직 모르는 것**: (다음에 파야 할 것)
**ADR 연결**: (이 학습이 어떤 결정으로 이어졌는가)
```

---

## 2026-04-03

**오늘 한 것**: 포트폴리오 전략 문서 작성 + ADR 001~003

**ADR-001에서 배운 것**:
- Kafka와 RabbitMQ의 근본적 차이: Kafka는 로그 기반(메시지 보존), RabbitMQ는 큐 기반(소비 후 삭제)
- Consumer Group의 개념: 같은 토픽을 독립적으로 여러 서비스가 소비할 수 있음
- 파티션 수 = Consumer 최대 병렬 처리 수

**ADR-002에서 배운 것**:
- Coroutines는 경량 스레드가 아니라 "중단 가능한 계산 단위"
- `suspend` 함수는 스레드를 점유하지 않고 중단 → 같은 스레드에서 다른 코루틴 실행 가능
- Virtual Threads와의 차이: Coroutines는 언어 레벨, Virtual Threads는 JVM 레벨
- JPA + Coroutines 조합 시 `withContext(Dispatchers.IO)` 필수 이유: JPA는 블로킹 API

**ADR-003에서 배운 것**:
- Cache Stampede: 캐시 만료 순간 다수 요청이 동시에 DB로 → DB 과부하
- Double-Check Locking: 락 획득 후 다시 캐시 확인하는 이유 = 다른 스레드가 이미 캐싱했을 수 있음
- Redisson 분산락이 직접 구현 대비 나은 이유: `lua script`로 락 획득/해제를 원자적으로 처리

**아직 모르는 것**:
- Testcontainers로 실제 Kafka 통합 테스트 작성하는 방법
- Spring Kafka의 `@KafkaListener`와 Manual Commit 조합 정확한 설정
- Outbox Relay를 어떻게 구현하는가 (스케줄러? CDC? 트리거?)

---

<!-- 아래부터 새 학습 항목 추가 -->
