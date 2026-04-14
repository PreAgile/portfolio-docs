# CLAUDE.md — AI 협업 가이드

이 파일은 Claude Code(AI)가 이 저장소에서 작업할 때 따라야 할 컨텍스트와 규칙을 정의합니다.
새 대화를 시작할 때 이 파일을 먼저 읽고 저장소 구조와 목표를 파악하세요.

---

## 이 저장소의 목적

한국 빅테크(네이버, 카카오, 토스, 쿠팡, 당근마켓) 백엔드 포트폴리오의 **설계 문서 허브**입니다.
실제 구현 코드는 각 서비스 저장소(platform-api, platform-event-consumer, async-crawler)에 있습니다.

**핵심 철학**: "당해보기 → 측정 → 딥다이브 → 해결 → 증거 → 스토리"
기술을 먼저 도입하지 않는다. 기술이 없을 때의 문제를 먼저 체감하고, Before/After 수치로 증명한다.

---

## 저장소 구조

```
portfolio-docs/
├── README.md               ← 포트폴리오 전체 소개 (공개 얼굴)
├── CLAUDE.md               ← 지금 읽고 있는 파일. AI 협업 규칙
├── STRATEGY.md             ← Deep Dive Track 전략 (6개 트랙 정의)
├── LEARNING-LOG.md         ← 실험 일지 (가설 → 실험 → 결과 → 발견)
├── EXPERIENCE-STORIES.md   ← 실무 경험 7개 에피소드
├── STRATEGY-V2.md          ← 10개사 JD 분석 (아카이브)
├── FEEDBACK.md             ← 초기 전략 갭 분석 (아카이브)
├── docs/
│   ├── adr/                ← 기술 결정 근거 (ADR-001~005)
│   ├── interview-prep/     ← 꼬리질문 4단계 방어 가이드
│   ├── ddd/                ← 도메인 설계 (Bounded Context)
│   ├── architecture/       ← MSA 서비스 경계 설계
│   ├── testing/            ← TDD 케이스 가이드
│   ├── ai/                 ← AI 설계 협업 로그
│   └── benchmarks/         ← 성능 측정 결과 (실측 후 기록)
└── projects/
    └── infra/              ← 로컬 인프라 (docker-compose, k6, MySQL, Prometheus)
```

---

## 파일별 역할과 참고 방법

### STRATEGY.md
- **역할**: 6개 Deep Dive Track 전략. 각 트랙에 "당해보기 실험 → CS 딥다이브 → 구현 → 측정 → 면접 스토리" 정의
- **언제 참고**: 새 기능/서비스를 제안할 때, 현재 트랙 진행 방향이 맞는지 검토할 때
- **수정 기준**: 트랙 진행 상태 업데이트, 새 트랙 추가 시

### LEARNING-LOG.md
- **역할**: 트랙별 실험 기록 일지. "당해보기"의 증거를 남기는 곳
- **형식**: `가설 / 실험 방법 / 결과 / 발견 / 다음 질문 / 면접 한 줄`
- **언제 참고**: 실험을 수행했을 때 기록, 이전 실험 결과 확인
- **수정 기준**: 실험을 수행할 때마다 추가. 결과가 나오면 수치 채우기

### docs/adr/
- **역할**: 모든 중요한 기술 결정의 근거 문서
- **작성 규칙**:
  - 반드시 ADR-TEMPLATE.md 형식 사용
  - 대안을 최소 2개 이상 검토
  - "AI와 함께 검토한 내용" 섹션 포함
  - "이 결정이 틀렸다고 판단할 기준" 필수 작성
  - 기술적 이유만 기록

### projects/infra/docker-compose.yml
- **역할**: 로컬 개발 환경 전체 정의 (Track 0의 기반)
- **포함된 서비스**: Kafka (KRaft 모드), Redis, MySQL, Prometheus, Grafana, Kafka UI, k6
- **주의**: k6는 `--profile loadtest`로만 실행됨

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

### 실험 기록 규칙

AI가 코드를 작성하거나 실험을 도와주면, 다음을 LEARNING-LOG.md에 기록:
1. **가설**: 무엇을 확인하려고 했는가
2. **결과**: 실측 수치 또는 관찰 (예상과 같았는가, 달랐는가)
3. **발견**: 새로 배운 것. 예상과 달랐던 점
4. **면접 한 줄**: 이 실험으로 면접에서 말할 수 있는 것

### 코드 작성 후 반드시 할 것

1. 이 코드가 왜 이렇게 동작하는지 설명할 수 있는가
2. 면접관이 "왜 이렇게 했나요?" 물어봤을 때 답할 수 있는가
3. 이 코드의 실패 케이스는 무엇인가

---

## 현재 프로젝트 상태 (2026-04-14)

### Deep Dive Track 진행 상태

| Track | 주제 | 상태 | 다음 할 일 |
|:-----:|------|:----:|-----------|
| 0 | 측정 기반 구축 | 🔜 | docker-compose 완성 + k6 기준선 측정 |
| 1 | 동시성 & 분산 락 | 🔜 | platform-api 스켈레톤 → 락 없이 동시성 실험 |
| 2 | Kafka & 메시지 안정성 | 🔜 | auto-commit + kill 실험 |
| 3 | 캐시 & Stampede | 🔜 | Track 1 완료 후 |
| 4 | 장애 격리 & 복원력 | 🔜 | WireMock 장애 시뮬레이션 |
| 5 | 이벤트 드리븐 & Outbox | 🔜 | Track 2 완료 후 |

### 완료된 문서
- [x] STRATEGY.md — Deep Dive Track 전략 (6개 트랙)
- [x] ADR-001~005 (Kafka, Coroutines, Cache, 분산 락, Outbox)
- [x] EXPERIENCE-STORIES.md (실무 7개 에피소드)
- [x] depth-guide.md (꼬리질문 4단계 방어)
- [x] 로컬 인프라 docker-compose.yml
- [x] STRATEGY-V2.md (10개사 JD 분석)

### 다음 액션
- [ ] Track 0: `docker-compose up -d` → 모든 서비스 healthy 확인
- [ ] Track 0: k6 기준선 측정
- [ ] Track 1: platform-api Spring Boot 스켈레톤 생성
- [ ] Track 1: 락 없이 100 스레드 동시성 실험 → LEARNING-LOG 기록
- [ ] Track 2: Testcontainers 기반 Kafka 통합 테스트

---

## 기술 결정 요약 (ADR 핵심)

| 영역 | 결정 | 대안 | 근거 | Track |
|------|------|------|------|:-----:|
| 메시지 브로커 | Kafka | RabbitMQ, Redis Streams | 메시지 재처리, Consumer Group 독립 소비 | 2 |
| 비동기 처리 | Kotlin Coroutines | Virtual Threads, WebFlux | Structured Concurrency, suspend 명시성 | 2, 4 |
| 캐시 전략 | Cache-Aside + 분산락 | 단순 @Cacheable, 2계층 캐시 | Stampede 방지, Double-Check 패턴 | 3 |
| 분산 락 | Redisson | SET NX + Lua | watchdog 자동 연장, 좀비 락 방지 | 1 |
| Outbox Relay | 폴링 5초 | CDC (Debezium) | 인프라 복잡도 대비 허용 가능한 지연 | 5 |

---

## 커밋 컨벤션

```
feat(영역): 무엇을 했는가

- 왜 이렇게 했는가 (배경)
- 이전 방식의 문제
- 이 방식으로 변경 후 달라진 점

Closes #이슈번호
```

---

## 면접 대비 질문 맵

| 질문 | Track | 증거 |
|------|:-----:|------|
| "Kafka를 선택한 이유는?" | 2 | ADR-001 + 유실 실험 |
| "분산락 없으면 어떻게 되나요?" | 1 | 락 방식별 실측 비교표 |
| "Cache Stampede가 뭔지, 어떻게 방지했나요?" | 3 | Stampede 재현 + 분산 락 해결 실험 |
| "Circuit Breaker 설정값 근거는?" | 4 | failureRateThreshold 범위 비교 실험 |
| "Outbox Pattern은 왜 썼나요?" | 5 | 직접 발행 유실 재현 + Outbox 해결 |
| "TPS 수치 어떻게 측정했나요?" | 0 | k6 스크립트 + 환경 스펙 |
| "Consumer Lag 어떻게 모니터링하나요?" | 2 | Grafana 대시보드 |

---

## 주의사항

- **회사 코드 노출 금지**: 실제 cmong-mq, cmong-be, cmong-scraper-js 코드는 절대 이 저장소에 포함하지 않음
- **회사 이름/도메인 노출 금지**: 커밋 메시지, 코드 주석, 문서에 회사명 기재 금지
- **수치는 실측값만**: 측정하지 않은 수치를 README나 ADR에 기재하지 않음. 예상치는 "예상: X" 표기
- **ADR은 기술적 이유만**: "빅테크에서 많이 쓰니까" 같은 외부 동기는 ADR에 포함하지 않음
