# JD 분석 — 한국 IT 빅테크 백엔드 시니어 포지션

> **목적**: 타겟 회사별 JD를 분석하여 포트폴리오 우선순위를 결정한다.
> 이 분석은 STRATEGY-V2.md의 회사별 준비 전략의 근거가 된다.
>
> **분석 기준일**: 2026-04-11 (변경 시 재분석 필요)

---

## 분석 요약 — 기술 스택 교집합

10개사 JD에서 공통으로 등장하는 기술 요건:

| 기술 | 등장 빈도 | 내 현황 | 우선순위 |
|------|:-------:|--------|:-------:|
| Java (8+) | 10/10 | 포트폴리오에서 증명 중 | 최우선 |
| Spring Boot / Spring | 10/10 | platform-api로 증명 중 | 최우선 |
| Kotlin | 7/10 | OSS 기여 + platform-event-consumer | 높음 |
| MySQL / PostgreSQL | 9/10 | EXPERIENCE-STORIES #3 + ADR | 높음 |
| Redis | 8/10 | ADR-003 + EXPERIENCE-STORIES #6 | 높음 |
| Kafka / Message Queue | 6/10 | ADR-001 + platform-event-consumer | 높음 |
| JPA / Hibernate | 8/10 | EXPERIENCE-STORIES #1 | 높음 |
| MSA / 분산 시스템 | 7/10 | MSA-BOUNDARY.md + 3개 서비스 | 높음 |
| Docker / K8s | 7/10 | docker-compose 인프라 완성 | 중간 |
| 테스트 (Junit/Kotest) | 8/10 | TDD-CASES.md + kotest OSS 기여 | 높음 |

---

## 회사별 JD 핵심 분석

### 토스 (Toss)

**핵심 스택**
- Kotlin 우대 (팀 전체 Kotlin 전환 완료)
- Spring Boot + JPA
- Kafka 기반 이벤트 드리븐
- Testcontainers 기반 통합 테스트 강조

**눈에 띄는 요건**
- "테스트를 즐겨 쓰는 개발자"
- "코드 품질에 대한 높은 기준"
- "비즈니스 문제를 기술로 해결한 경험"

**어필 포인트 매핑**

| 토스 요건 | 포트폴리오 증거 |
|---------|--------------|
| Kotlin 역량 | kotest OSS 6개 PR + platform-event-consumer |
| 테스트 문화 | TDD-CASES.md + Testcontainers 통합 테스트 계획 |
| 결제 시스템 이해 | EXPERIENCE-STORIES #1 (멱등성 + 트랜잭션) |
| 이벤트 드리븐 | ADR-001 + ADR-005 (Outbox Pattern) |

**준비 갭**
- Kotlin coroutine Flow API 심화 필요
- TDD 케이스 실제 코드로 증명 필요

---

### 카카오 (Kakao)

**핵심 스택**
- Java / Kotlin
- Spring Framework (심화)
- 대용량 트래픽 처리 경험

**눈에 띄는 요건**
- "트래픽이 많은 서비스에서 장애 경험"
- "성능 최적화 경험 (수치 기반)"
- "JVM 최적화 (GC 튜닝 등)"

**어필 포인트 매핑**

| 카카오 요건 | 포트폴리오 증거 |
|-----------|--------------|
| 대용량 처리 | EXPERIENCE-STORIES #3 (수십만 Shop 집계) |
| 성능 최적화 | k6 부하테스트 + 캐시 전략 (ADR-003) |
| 장애 대응 | EXPERIENCE-STORIES #5 (서킷 브레이커) |

**준비 갭**
- k6 실측 수치 필요 (현재 예상치만)
- JVM GC 튜닝 실제 경험 없음

---

### 우아한형제들 (Woowa Brothers)

**핵심 스택**
- Kotlin 우대
- Spring Framework (DDD 중심)
- Spring Batch 경험
- JPA 심화

**눈에 띄는 요건**
- "DDD 설계 경험"
- "객체지향 설계 원칙"
- "대용량 배치 처리"

**어필 포인트 매핑**

| 우아한형제들 요건 | 포트폴리오 증거 |
|---------------|--------------|
| DDD | DOMAIN-MODEL.md (새로 추가) |
| Spring Batch | async-crawler (Spring Batch 계획) |
| 대용량 배치 | EXPERIENCE-STORIES #3 + ADR |
| Kafka | ADR-001 + platform-event-consumer |

**준비 갭**
- DDD 실제 코드 필요 (DOMAIN-MODEL.md 문서만으로 부족)
- Spring Batch 실제 구현 필요

---

### 라인 (LINE)

**핵심 스택**
- Java / Kotlin
- Armeria 프레임워크 (LINE 오픈소스)
- JVM 심화 (GC, 메모리 모델)
- 분산 시스템

**눈에 띄는 요건**
- "JVM 내부 동작 이해"
- "대규모 분산 시스템 설계"
- "오픈소스 기여 경험"

**어필 포인트 매핑**

| 라인 요건 | 포트폴리오 증거 |
|---------|--------------|
| JVM 심화 | depth-guide.md (GC, 메모리 모델 4단계) |
| 분산 시스템 | MSA-BOUNDARY.md + EXPERIENCE-STORIES |
| OSS 기여 | 10개 PR 머지 (kotest, spring-cloud 등) |
| Armeria | OPENSOURCE-STRATEGY.md (다음 타겟) |

**준비 갭**
- Armeria OSS 기여 아직 없음 (가장 중요)
- JVM GC 실제 튜닝 경험 없음

---

### 쿠팡 (Coupang)

**핵심 스택**
- Java
- 시스템 디자인 (Bar Raiser 면접)
- DB 설계 (샤딩, 파티셔닝)
- 대규모 트래픽

**눈에 띄는 요건**
- "Bar Raiser 면접" — 기술 깊이 + 설계 근거
- "왜 이렇게 설계했는가" 논리적 설명
- "수치 기반 성능 분석"

**어필 포인트 매핑**

| 쿠팡 요건 | 포트폴리오 증거 |
|---------|--------------|
| 시스템 디자인 | ADR-001~005 + MSA-BOUNDARY |
| DB 설계 | EXPERIENCE-STORIES #3 (인덱스) |
| 수치 기반 | PERFORMANCE-RESULTS.md (실측 후 채울 것) |

**준비 갭**
- 수치가 아직 예상치
- DB 샤딩/파티셔닝 실제 설계 경험 없음

---

### 네이버 (Naver)

**핵심 스택**
- Java
- 대규모 트래픽 (수억 DAU)
- CS 기초 심화

**눈에 띄는 요건**
- "자료구조 / 알고리즘 이해"
- "네트워크, OS 기초"
- "JVM 심화"

**어필 포인트 매핑**

| 네이버 요건 | 포트폴리오 증거 |
|-----------|--------------|
| CS 기초 | depth-guide.md (9개 영역 4단계) |
| JVM | GC 알고리즘 설명 (depth-guide) |
| 대규모 캐시 | EXPERIENCE-STORIES #6 + ADR-003 |

**준비 갭**
- CS 기초는 면접 준비지 코드 증거 아님
- 코딩 테스트 준비 필요 (네이버는 알고리즘 비중 높음)

---

### 당근 (Daangn)

**핵심 스택**
- Kotlin 선호
- 실용주의 설계
- 빠른 실험 문화

**눈에 띄는 요건**
- "과도한 설계보다 빠른 실행"
- "컬쳐핏" — 자율과 책임
- "실제 문제를 해결한 경험"

**어필 포인트 매핑**

| 당근 요건 | 포트폴리오 증거 |
|---------|--------------|
| Kotlin | kotest OSS + platform-event-consumer |
| 실용 설계 | ADR의 "이 결정이 틀렸다고 판단할 기준" |
| 실무 문제 | EXPERIENCE-STORIES 7개 에피소드 |

**준비 갭**
- 당근은 과도한 설계를 싫어함 → ADR이 너무 많으면 역효과 가능
- 빠른 실행 능력을 보여줄 "작게 완성된 기능" 필요

---

## 준비 우선순위 매트릭스

| 준비 항목 | 토스 | 카카오 | 우아한형제들 | 라인 | 쿠팡 | 합계 |
|---------|:---:|:-----:|:----------:|:---:|:---:|:---:|
| Java + Spring 코드 | ● | ● | ● | ● | ● | 5 |
| Kotlin + Coroutine | ● | ○ | ● | ● | ○ | 4 |
| 실측 수치 (k6) | ○ | ● | ○ | ○ | ● | 3 |
| DDD 설계 | ○ | ○ | ● | ○ | ○ | 2 |
| JVM 튜닝 | ○ | ● | ○ | ● | ○ | 3 |
| Armeria OSS 기여 | ○ | ○ | ○ | ● | ○ | 1 |
| TDD 코드 증거 | ● | ○ | ● | ○ | ○ | 3 |

**● = 필수, ○ = 가산점**

### 결론: 최우선 3가지

1. **Java + Spring 실제 코드** — 모든 회사 공통 (platform-api 구현)
2. **k6 실측 수치** — 카카오, 쿠팡 필수 (docker-compose에 환경 준비됨, 실행만)
3. **TDD 코드 증거** — 토스, 우아한형제들 (TDD-CASES.md → 실제 코드로)
