# CLAUDE.md — AI 협업 가이드

이 파일은 Claude Code(AI)가 이 저장소에서 작업할 때 따라야 할 컨텍스트와 규칙을 정의합니다.
새 대화를 시작할 때 이 파일을 먼저 읽고 저장소 구조와 목표를 파악하세요.

---

## 이 저장소의 목적

한국 빅테크(네이버, 카카오, 토스, 쿠팡, 당근마켓) 백엔드 포트폴리오의 **설계 문서 허브**입니다.
실제 구현 코드는 각 서비스 저장소(platform-api, platform-event-consumer, async-crawler)에 있습니다.

---

## 저장소 구조

```
portfolio-docs/
├── README.md               ← 포트폴리오 전체 소개 + 링크 허브 (공개 얼굴)
├── CLAUDE.md               ← 지금 읽고 있는 파일. AI 협업 규칙
├── STRATEGY.md             ← 포트폴리오 전략의 근간. 변경 시 ADR 작성 필수
├── FEEDBACK.md             ← 전략 갭 분석. 개선 필요사항 목록
├── LEARNING-LOG.md         ← 구현하면서 배운 것들. 블로그 초안 역할
├── docs/
│   └── adr/
│       ├── ADR-TEMPLATE.md          ← 새 ADR 작성 시 이 템플릿 사용
│       ├── ADR-001-kafka-vs-rabbitmq.md
│       ├── ADR-002-coroutines-vs-virtual-threads.md
│       └── ADR-003-cache-strategy.md
└── projects/
    └── infra/
        ├── docker-compose.yml       ← 로컬 인프라 (Kafka, Redis, MySQL, Prometheus, Grafana, k6)
        ├── k6/load-test.js          ← 부하테스트 스크립트
        ├── mysql/init.sql           ← DB 초기화
        └── prometheus/prometheus.yml
```

---

## 파일별 역할과 참고 방법

### STRATEGY.md
- **역할**: 포트폴리오의 나침반. 왜 이 프로젝트를 만드는지, 어떤 문제를 해결하는지, 학습 로드맵이 담김
- **언제 참고**: 새 기능/서비스를 제안할 때, 현재 방향이 맞는지 검토할 때
- **수정 기준**: 프로젝트 방향이 바뀔 때만 수정. 단순 구현 결정은 ADR로 처리

### docs/adr/
- **역할**: 모든 중요한 기술 결정의 근거 문서
- **언제 참고**: "왜 이 기술을 썼나요?" 질문이 나올 수 있는 결정을 할 때마다
- **작성 규칙**:
  - 반드시 ADR-TEMPLATE.md 형식 사용
  - 대안을 최소 2개 이상 검토
  - "AI와 함께 검토한 내용" 섹션에 실제로 AI에게 물어본 것과 답변 요약 포함
  - "이 결정이 틀렸다고 판단할 기준" 필수 작성
  - 기술적 이유만 기록 (포트폴리오 어필, 취업 목적 등 외부 동기는 제외)

### LEARNING-LOG.md
- **역할**: 구현하면서 배운 것들을 날짜별로 기록
- **형식**: `날짜 / 배운 것 / 직접 확인한 것 / 아직 모르는 것 / ADR 연결`
- **언제 참고**: 이전에 같은 개념을 공부한 기록이 있는지 확인할 때
- **수정 기준**: 새로운 것을 배울 때마다 추가. 수정보다 추가 위주

### FEEDBACK.md
- **역할**: 현재 전략의 갭 분석. "무엇이 부족한가"를 정리
- **언제 참고**: 다음 할 일을 결정할 때, 우선순위를 정할 때
- **수정 기준**: 피드백 항목이 해결되면 완료 표시. 새 갭 발견 시 추가

### projects/infra/docker-compose.yml
- **역할**: 로컬 개발 환경 전체 정의
- **포함된 서비스**: Kafka (KRaft 모드), Redis, MySQL, Prometheus, Grafana, Kafka UI, k6
- **주의**: k6는 `--profile loadtest`로만 실행됨 (기본 up에서 제외)

---

## AI 협업 원칙

### 내가 결정하고 AI가 보조하는 것

```
내가 한다:
- 문제 정의
- 트레이드오프 최종 판단
- ADR 작성 (AI가 초안 도움 가능)
- 테스트 시나리오 설계 (assert 조건)
- 코드 라인별 이해 확인

AI가 돕는다:
- 대안 탐색 ("A vs B 트레이드오프 분석해줘")
- 구현 (내가 설계한 것을 코드로)
- 검증 ("이 설계의 엣지 케이스가 있어?")
- 문서 초안 (ADR, README)
```

### AI에게 물어보는 올바른 방식

```
❌ "Outbox Pattern 구현해줘"
✅ "내가 Outbox Relay 폴링 주기를 100ms로 설정하려는데,
    DB 부하 관점에서 어떤 리스크가 있어? 대안이 있어?"

❌ "Kafka 설정해줘"
✅ "max.poll.records를 100으로 설정한 이유가 '처리 시간 × 100 < max.poll.interval.ms'인데,
    이 계산이 맞는지, 놓친 게 있는지 검증해줘"
```

### 코드 작성 후 반드시 할 것

AI가 코드를 작성하면 다음을 확인하고 LEARNING-LOG.md에 기록:
1. 이 코드가 왜 이렇게 동작하는지 설명할 수 있는가
2. 면접관이 "왜 이렇게 했나요?" 물어봤을 때 답할 수 있는가
3. 이 코드의 실패 케이스는 무엇인가

---

## 현재 프로젝트 상태 (2026-04-03)

### 완료
- [x] 포트폴리오 전략 수립 (STRATEGY.md)
- [x] ADR-001: Kafka vs RabbitMQ
- [x] ADR-002: Kotlin Coroutines vs Virtual Threads
- [x] ADR-003: Cache 전략 (Cache-Aside + Stampede 방지)
- [x] 로컬 인프라 (docker-compose.yml)
- [x] portfolio-docs GitHub repo 공개

### 진행 중
- [ ] docker-compose up -d 후 모든 서비스 healthy 확인
- [ ] ADR-004: Idempotent Consumer 구현 방식
- [ ] ADR-005: Outbox Relay 폴링 주기 결정

### 예정
- [ ] platform-api GitHub repo 생성 + Spring Initializr 뼈대
- [ ] Testcontainers 기반 첫 Kafka 통합 테스트 통과
- [ ] platform-event-consumer repo 생성
- [ ] async-crawler repo 생성
- [ ] GitHub Actions CI 파이프라인

---

## 기술 결정 요약 (ADR 핵심)

| 영역 | 결정 | 대안 | 근거 |
|------|------|------|------|
| 메시지 브로커 | Kafka | RabbitMQ, Redis Streams | 메시지 재처리, Consumer Group 독립 소비 |
| 비동기 처리 | Kotlin Coroutines | Virtual Threads, WebFlux | Structured Concurrency, Flow API, suspend 명시성 |
| 캐시 전략 | Cache-Aside + 분산락 | 단순 @Cacheable, 2계층 캐시 | Stampede 방지, Double-Check 패턴 |
| Kafka commit | Manual Commit | Auto Commit | 메시지 처리 보장, at-least-once |
| JPA + Coroutines | withContext(Dispatchers.IO) | - | JPA 블로킹 API → IO 스레드풀 필수 |

---

## 커밋 컨벤션

```
feat(영역): 무엇을 했는가

- 왜 이렇게 했는가 (배경)
- 이전 방식의 문제
- 이 방식으로 변경 후 달라진 점

Closes #이슈번호
```

예시:
```
docs(adr): ADR-004 Idempotent Consumer 구현 방식 결정

- processed_events 테이블 vs Redis Set 두 가지 대안 검토
- DB 트랜잭션과 멱등성 체크를 원자적으로 처리하기 위해 DB 방식 선택
- Redis 방식은 TTL 만료 시 중복 처리 위험 존재

Closes #4
```

---

## 면접 대비 질문 맵

ADR과 구현이 완료되면 다음 질문에 코드/문서로 답할 수 있어야 합니다.

| 질문 | 참고 파일 |
|------|---------|
| "Kafka를 선택한 이유는?" | ADR-001 |
| "Coroutines vs Virtual Threads 차이는?" | ADR-002 |
| "Cache Stampede가 뭔지, 어떻게 방지했나요?" | ADR-003 |
| "Outbox Pattern은 왜 썼나요?" | ADR-005 (예정) + platform-api 코드 |
| "@Transactional self-invocation 문제 아시나요?" | LEARNING-LOG.md Phase 1 |
| "Consumer Lag 어떻게 모니터링하나요?" | platform-event-consumer Grafana 대시보드 |
| "TPS 수치 어떻게 측정했나요?" | projects/infra/k6/load-test.js |
| "분산락 없으면 어떻게 되나요?" | platform-api 동시성 테스트 코드 |

---

## 주의사항

- **회사 코드 노출 금지**: 실제 cmong-mq, cmong-be, cmong-scraper-js 코드는 절대 이 저장소에 포함하지 않음
- **회사 이름/도메인 노출 금지**: 커밋 메시지, 코드 주석, 문서에 회사명 기재 금지
- **수치는 실측값만**: 측정하지 않은 수치를 README나 ADR에 기재하지 않음. 예상치는 "예상: X" 표기
- **ADR은 기술적 이유만**: "빅테크에서 많이 쓰니까" 같은 외부 동기는 ADR에 포함하지 않음
