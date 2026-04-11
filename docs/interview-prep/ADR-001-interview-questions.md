# ADR-001 면접 질문 대비

> **대상 ADR**: ADR-001 — Kafka vs RabbitMQ 메시지 브로커 선택
> **목적**: "왜 Kafka를 선택했나요?" 꼬리질문을 4단계 깊이로 방어한다.
>
> **작성일**: 2026-04-11

---

## 예상 질문 목록

### 기본 질문

**Q1. "왜 RabbitMQ가 아닌 Kafka를 선택하셨나요?"**

```
[1단계 답변 — 이것만 하면 주니어 수준]
"Kafka가 처리량이 높고 많이 쓰이기 때문입니다."

[2단계 답변 — Consumer Group과 재처리]
"핵심 이유는 두 가지입니다.

첫째, Consumer Group 독립 소비입니다.
'결제 완료' 이벤트를 대시보드 집계 서비스와 알림 서비스가 각자 처리해야 했습니다.
RabbitMQ는 하나의 큐에서 메시지를 꺼내면 사라지기 때문에,
두 서비스가 같은 메시지를 처리하려면 Fanout Exchange와 두 개의 큐가 필요합니다.
Kafka는 Consumer Group마다 독립적인 오프셋을 관리하므로,
하나의 토픽에서 여러 Consumer Group이 각자 처음부터 읽을 수 있습니다.

둘째, 재처리 용이성입니다.
외부 플랫폼 장애로 인한 일시적 실패 시, 수시간 전 메시지부터 다시 처리해야 했습니다.
RabbitMQ에서 이미 ACK된 메시지는 되돌릴 수 없지만,
Kafka는 오프셋을 과거로 되돌려 재처리가 가능합니다."

[3단계 답변 — 트레이드오프]
"물론 Kafka가 항상 좋은 선택은 아닙니다.
메시지 수가 적고 지연이 중요하다면 RabbitMQ가 더 적합합니다.
Kafka는 운영 복잡도가 높고(Broker, Consumer Group 모니터링 필요),
메시지 순서 보장이 파티션 내로 한정됩니다.
저희는 파티션 키를 shopId로 설정해서 같은 Shop의 이벤트가 같은 파티션에 가도록 했고,
이 결정이 ADR-001에 기록되어 있습니다."

[4단계 답변 — 실무 연결]
"실제 운영에서는 Consumer Lag 모니터링이 핵심이었습니다.
Lag이 갑자기 급증하면 Consumer 처리 속도 저하 또는 재밸런싱 발생을 의심합니다.
max.poll.interval.ms보다 처리 시간이 길어지면 Consumer가 강제 리밸런싱 되는데,
이를 막기 위해 max.poll.records를 처리 시간에 맞게 설정했습니다:
'처리 시간 × records 수 < max.poll.interval.ms'"
```

---

### 심화 질문

**Q2. "Kafka의 Exactly-once 처리는 어떻게 구현하셨나요?"**

```
"Exactly-once는 두 가지 레벨이 있습니다.

Producer → Broker 레벨:
Kafka의 Idempotent Producer(enable.idempotence=true)와
Transactional Producer를 사용하면 Producer 재시도 시 중복 발행을 방지합니다.

Broker → Consumer 레벨:
이건 Kafka 자체로는 At-least-once까지만 보장합니다.
Exactly-once는 Consumer 쪽에서 멱등성을 구현해야 합니다.

저희 구현 방식:
processed_events 테이블에 (topic, partition, offset)을 저장합니다.
Consumer 처리 시 이미 처리된 offset이면 스킵합니다.
이 체크와 비즈니스 로직 처리를 하나의 DB 트랜잭션으로 묶어서 원자적으로 처리합니다.
이것이 Transactional Outbox Pattern의 Consumer 쪽 대응인 Idempotent Consumer입니다."
```

**Q3. "파티션 개수는 어떻게 결정하셨나요?"**

```
"파티션 수 = max(Consumer 인스턴스 수, 목표 처리량 / 단일 파티션 처리량)으로 계산합니다.

실제로:
- Consumer 인스턴스: 최대 10개 예상
- 단일 파티션 처리량: ~1,000 msg/sec (평균 1ms 처리 가정)
- 목표 처리량: 5,000 msg/sec
- 계산: max(10, 5) = 10 파티션

파티션을 늘리면:
- 병렬 처리량 증가 ✅
- Consumer 리밸런싱 시간 증가 ❌
- 브로커 파일 핸들 수 증가 ❌

파티션은 한번 늘리면 줄이기 어려우므로 여유 있게 시작합니다.
저희는 초기 12개로 설정 (10개 + 여유 20%)."
```

**Q4. "Dead Letter Topic은 어떻게 처리하시나요?"**

```
"Spring Kafka의 @RetryableTopic을 사용합니다.
최대 3번 재시도 후 실패하면 [topic-name]-dlt 토픽으로 자동 라우팅됩니다.

DLT 처리 전략:
1. 즉시 처리: DLT Consumer가 자동 재처리 시도
   - 일시적 장애(외부 API 503)라면 이미 복구됐을 수 있음
   
2. 운영자 검토: 재처리 실패 시 알림 → Slack #alert
   - 비즈니스 로직 버그일 경우 코드 수정 후 수동 재처리
   
3. 영구 실패 처리: 최종적으로 처리 불가 메시지는
   dead_letter_archive 테이블에 보관 + 비즈니스 알림

중요한 것: DLT에 메시지가 쌓이는 것 자체가 알림이 되어야 합니다.
Grafana에서 DLT Consumer Lag 대시보드로 모니터링합니다."
```

**Q5. "Kafka Consumer Lag 급증 시 어떻게 대응하나요?"**

```
"Consumer Lag = Latest Offset - Consumer Current Offset

Lag 급증 원인 분류:
1. Consumer 처리 속도 저하
   - 원인: 외부 의존성(DB, Redis) 응답 지연
   - 대응: Consumer 스케일 아웃 (파티션 수 이내)
   
2. Producer 발행량 급증
   - 원인: 배치 작업, 이벤트 폭발
   - 대응: 임시 Consumer 추가 or 처리 우선순위 조정
   
3. Consumer 재밸런싱 루프
   - 원인: max.poll.interval.ms 초과 → Group 킥아웃 → 재밸런싱
   - 대응: max.poll.records 줄이기 or 처리 로직 비동기화

저희는 Grafana 대시보드에서 다음을 모니터링합니다:
- Consumer Lag (파티션별)
- Record Processing Time (P95, P99)
- Rebalance 발생 횟수
Lag > 10,000건 기준으로 Slack 알림 설정."
```

---

### 면접관이 파고들 수 있는 트랩 질문

**Q. "Kafka가 RabbitMQ보다 무조건 좋은 건 아니죠?"**

```
"맞습니다. 선택 기준이 다릅니다.

RabbitMQ가 더 적합한 경우:
- 즉각적인 메시지 삭제가 필요할 때 (GDPR, 민감 데이터)
- 복잡한 라우팅 로직이 필요할 때 (Exchange/Routing Key)
- 메시지 수가 적고 지연 민감도가 높을 때 (1ms 이하)
- 개발 편의성이 우선일 때 (RabbitMQ 관리 UI가 직관적)

저희 케이스에서 Kafka를 선택한 이유는 이미 설명한 것처럼
Consumer Group 독립성과 재처리 용이성이 핵심이었고,
운영 복잡도는 감수할 수 있는 트레이드오프로 판단했습니다."
```

**Q. "파티션 키를 shopId로 쓰면 특정 Shop에 요청이 집중될 때 hot partition 문제가 생기지 않나요?"**

```
"정확한 지적입니다. Hot Partition은 실제 위험입니다.

저희 데이터 특성:
- Shop당 이벤트 발생이 균등 분포 (최대 Shop 이벤트 수 / 전체 이벤트 수 ≈ 0.1% 이하)
- 특정 시간대 일시적 집중은 가능하지만 파티션 포화까지는 이르지 않음

만약 hot partition이 문제가 된다면:
1. 파티션 키를 shopId % N (샤딩)으로 변경
2. 단, 이 경우 같은 Shop의 이벤트 순서 보장이 깨질 수 있음
3. 순서 보장이 필요 없는 이벤트 타입은 round-robin으로 분산

이 트레이드오프를 ADR-001의 '재평가 기준'에 명시해두었습니다:
'특정 Shop의 이벤트가 전체의 10% 초과 시 파티셔닝 전략 재검토'"
```

---

## 면접 시나리오별 어필 전략

| 회사 | 어필 포인트 | 연결 스토리 |
|------|-----------|------------|
| 토스/카카오페이 | 멱등성 + 결제 이벤트 정합성 | Idempotent Consumer + Outbox Pattern |
| 우아한형제들 | 대용량 이벤트 처리 + DLT | Consumer Lag 모니터링 + 에러 분류 |
| 라인 | 분산 시스템 심화 + JVM | Consumer Group 리밸런싱 + VT vs Coroutine |
| 쿠팡 | 시스템 디자인 + 수치 | 파티션 계산 + Lag 모니터링 수치 |
| 네이버 | 대규모 트래픽 + 안정성 | Backpressure + Circuit Breaker |
