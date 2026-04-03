# 포트폴리오 전략 피드백

> 현재 문서들을 직접 리뷰한 결과. 강점과 수정이 필요한 부분을 구체적으로 정리.

---

## 1. 현재 전략 평가

### 잘 되고 있는 것

**STRATEGY.md**
- "AI를 도구로, 판단은 내가" 원칙은 매우 좋음. 면접관이 가장 싫어하는 건 AI가 짜준 코드를 설명 못 하는 것. 이 원칙을 지키면 그 위험이 없음.
- 실제 git 이슈 번호(#394, #388 등)를 매핑한 것 → 운영 경험의 근거가 생김. 좋음.
- 정직한 수치 원칙 → 올바름.

**ADR-001**
- 3개 대안 비교, AI 질문/답변 기록, "이 결정이 틀렸다고 판단할 기준" 항목 → 구조가 좋음.
- `max.poll.records: 100`에 근거가 있음 → 면접관이 물어볼 수 있는 설정값에 답이 준비됨.

### 수정이 필요한 것

---

## 2. 문서별 구체적 수정 포인트

### STRATEGY.md

**문제 1: 프로젝트 이름**

`cmong-event-pipeline`, `cmong-api-server`, `cmong-crawler-engine` — 이 이름들은 회사 내부 코드네임과 너무 가까움. 공개 GitHub 리포지토리로 쓰면 면접관이 "회사 코드를 공개한 건가?" 의심할 수 있음.

```
수정 제안:
- cmong-event-pipeline → platform-event-pipeline (또는 kafka-outbox-demo)
- cmong-api-server → platform-api (또는 resilient-api)
- cmong-crawler-engine → async-crawler
```

**문제 2: 테스트 전략 완전 누락**

카카오, 토스, 쿠팡은 테스트 코드를 직접 본다. 현재 STRATEGY.md에 테스트 언급이 한 줄도 없음.

```
추가 필요:
Phase 2 Kafka 심화 → Testcontainers로 Kafka 통합 테스트 추가
Phase 3 구현 → 각 프로젝트마다 테스트 목표 커버리지 명시
```

Testcontainers는 단독으로도 강력한 어필 포인트다. "Docker 없이 로컬에서 Kafka 통합 테스트를 JUnit으로 돌린다"는 경험은 토이 프로젝트와 확실히 다른 신호다.

**문제 3: "다음 액션" 섹션이 낡음**

ADR-001은 이미 만들었는데 여전히 TODO로 남아있음. 이 문서가 살아있는 문서여야 한다면 현재 상태를 반영해야 함.

```
수정: 완료된 항목에 [x] 표시, 날짜 추가
```

**문제 4: Project 1과 Project 2 분리의 한계**

Transactional Outbox Pattern의 핵심은 API 요청이 들어왔을 때 **같은 트랜잭션 안에서** DB 저장 + Outbox 이벤트 저장이 일어나는 것. 그런데 Project 1(event-pipeline)과 Project 2(api-server)가 분리되어 있으면 이 핵심 장면을 보여줄 수가 없음.

```
수정 방향 A: Project 1과 2를 하나의 서비스로 합침 (더 자연스러운 MSA 구조)
  - api-server가 DB에 저장 + Outbox 이벤트 저장 (같은 트랜잭션)
  - event-relay가 Outbox 폴링 → Kafka 발행
  - consumer가 Kafka 소비 → 처리

수정 방향 B: 분리를 유지하되 README에 두 프로젝트의 연결 관계 다이어그램 포함
```

**문제 5: 도메인이 너무 인프라 중심**

현재 3개 프로젝트 모두 "크롤링", "메시지 파이프라인" 중심. 토스/카카오페이를 노린다면 비즈니스 도메인 로직이 있어야 함. 크롤러 도메인만으로는 "결제 정합성을 어떻게 보장하나요?" 같은 질문에 연결이 어려움.

```
제안: cmong-api-server의 도메인을 크롤링 관리 API가 아닌,
      크롤링 데이터 기반의 주문/리뷰/가게 관리 API로 확장.
      → 이렇게 하면 트랜잭션 + 동시성 + 캐싱 + 이벤트를 하나의 도메인에서 보여줄 수 있음.
```

---

### ADR-001

**문제 1: "포트폴리오 어필 약함"이라는 이유**

```
현재: "네이버/카카오/토스에서 주로 Kafka를 사용 → 포트폴리오 어필 약함"
문제: 이건 기술적 이유가 아님. 면접에서 이걸 말하면 역효과.
수정: 이 항목을 삭제하고 기술적 단점만 남김.
```

**문제 2: 배경 설명의 모호함**

ADR-001 배경에서 "현재 회사에서 Python + RabbitMQ를 운영하면서..."라고 시작하는데, 이 ADR이 회사에서 쓰던 것을 Kafka로 교체하는 결정인지, 아니면 새 포트폴리오 프로젝트에서 처음부터 Kafka를 선택하는 결정인지 불명확.

```
수정: "포트폴리오 프로젝트에서 메시지 브로커를 선택하는 결정"임을 명확히 함.
     회사 경험은 배경/문제 정의의 근거로만 쓰고, 결정 맥락을 분리.
```

---

### docker-compose.yml

**잘 됨**: KRaft 모드 사용 (Zookeeper 없음) → 2026년 기준 올바른 선택.

**누락 1**: MySQL init.sql이 참조되는데 파일 없음.
```
projects/infra/mysql/init.sql 파일 생성 필요
```

**누락 2**: k6 컨테이너가 없음. 부하테스트를 docker-compose 안에서 실행할 수 있게 추가하면 좋음.
```yaml
k6:
  image: grafana/k6:latest
  volumes:
    - ./k6:/scripts
  command: run /scripts/load-test.js
  depends_on:
    - grafana
```

---

## 3. 추가로 만들어야 할 문서/파일

| 문서 | 우선순위 | 이유 |
|------|---------|------|
| ADR-002: Kotlin Coroutines vs Virtual Threads | 높음 | STRATEGY에서 결정은 됐는데 근거 문서가 없음 |
| ADR-003: Cache 전략 선택 | 높음 | 면접 단골 질문 |
| projects/infra/mysql/init.sql | 높음 | docker-compose에서 참조하는데 없음 |
| projects/infra/k6/load-test.js | 중간 | 부하테스트 스크립트 없으면 수치 측정 불가 |
| LEARNING-LOG.md | 중간 | Phase 1~2 학습 과정 기록 → 블로그 초안 역할 |

---

## 4. 우선순위 액션 플랜

### 1순위: docker-compose 완성 + 실제 실행 확인 (오늘~내일)

```bash
# 목표: docker-compose up -d 후 모든 서비스 healthy 상태 확인
cd resume/projects/infra
docker-compose up -d
docker-compose ps
```

mysql/init.sql 생성, 헬스체크 통과 확인. 여기서 막히면 아무것도 시작 안 됨.

**완료 기준**: Kafka UI (localhost:8989), Grafana (localhost:3000) 접속 가능

---

### 2순위: ADR-002 작성 (이번 주)

Kotlin Coroutines를 선택한 이유를 ADR로 작성. 코드 짜기 전에 이걸 먼저.

- Spring MVC + Virtual Threads vs Kotlin Coroutines 비교
- I/O 바운드 워크로드에서의 차이
- 토스/카카오 실제 스택과의 연결

---

### 3순위: Project 1 뼈대 (Spring Initializr) + 첫 통합 테스트 (1~2주)

```
목표: Kafka Producer → Consumer 흐름이 Testcontainers 기반 테스트로 통과
```

이게 되면 "실제로 돌아가는 코드"가 생긴다. 여기서 첫 meaningful 커밋이 나옴.

---

### 4순위: Outbox Pattern 구현 + 테스트 (2~3주)

단순 Kafka 예제가 아닌, DB 트랜잭션과 Outbox를 함께 묶은 구현.

```kotlin
// 이 테스트가 통과해야 의미 있음
@Test
fun `DB 저장 후 서버 크래시 시뮬레이션해도 메시지는 최종적으로 발행된다`() {
    // given: Outbox 테이블에 이벤트 저장
    // when: Outbox Relay가 재시작
    // then: Kafka에 이벤트가 발행됨
}
```

---

### 5순위: k6 부하테스트 + README 완성 (3~4주)

측정 없이 README 쓰지 말 것. 구현이 끝나고 수치가 나오면 그때 README 완성.

---

## 5. 핵심 기술 포인트 - 지금 빠진 영역

| 영역 | 현재 상태 | 보완 필요 |
|------|---------|---------|
| 테스트 코드 | STRATEGY에 언급 없음 | Testcontainers 통합 테스트 전략 추가 |
| GitHub Actions CI | 완전 없음 | 최소한 빌드+테스트 자동화 파이프라인 |
| Kotlin 언어 특성 활용 | 기술 나열만 됨 | data class, sealed class, extension function이 실제 도메인에서 쓰이는 예시 |
| 에러 처리 전략 | 없음 | GlobalExceptionHandler, 에러 코드 체계 |
| API 문서화 | 없음 | Swagger/OpenAPI 3.0 (Spring Doc) |

---

## 요약

**지금 당장 고칠 것:**
1. mysql/init.sql 생성 → docker-compose 실행 가능 상태로
2. ADR-001에서 "포트폴리오 어필 약함" 삭제
3. STRATEGY.md 다음 액션 섹션 현재 상태로 업데이트
4. 프로젝트 이름 cmong-* → 중립적 이름으로

**다음에 만들 것:**
1. ADR-002 (Coroutines vs Virtual Threads)
2. LEARNING-LOG.md (학습 일지)
3. k6 스크립트 뼈대

**나중에 만들 것:**
- GitHub Actions CI 파이프라인
- API 문서 (SpringDoc)
- 각 프로젝트 README 완성본

---

_생성일: 2026-04-03 | 다음 리뷰: Project 1 첫 커밋 이후_
