# OSS 기여 타겟 프로젝트 분석 — 국내 대기업 백엔드 어필용

> **목표**: Spring Boot + JPA + Kafka + Redis + PostgreSQL 스택의 OSS에 기여하여 대기업 시니어 백엔드 어필
> **작성일**: 2026-04-10
> **검증 방법**: 모든 기술 스택은 실제 build.gradle / pom.xml에서 직접 확인

---

## 국내 빅테크 금융권 실제 기술 스택 (출처 확인됨)

| | 카카오뱅크 | 토스뱅크(채널) | 네이버파이낸셜 | 쿠팡페이 |
|---|---|---|---|---|
| **언어** | Java 11+ / Kotlin | Kotlin (주력) | Java / Kotlin | Java / Kotlin |
| **프레임워크** | Spring Boot | Spring Boot | Spring Boot | Spring Boot |
| **ORM** | JPA | JPA (Hibernate) | JPA + QueryDSL | JPA 추정 |
| **DB** | Oracle(계정) + MySQL(채널) | Oracle(계정) + MySQL(채널) | Oracle + MySQL + MongoDB | MySQL + PostgreSQL |
| **메시징** | RabbitMQ + Kafka | Kafka | Kafka | Kafka |
| **빌드** | Gradle | Gradle | Gradle | Gradle |
| **아키텍처** | MSA 전환 중 | MSA 완료 (은행 최초) | MSA | MSA |

> 출처: 토스 SLASH 23 발표, 카카오뱅크 if kakao 2019, 각사 채용공고, 기술블로그

### 국내 대기업 공통 분모

```
Spring Boot + JPA(Hibernate) + Kafka + MySQL/PostgreSQL + Redis + Gradle + K8s
```

---

## TOP 10 프로젝트 (검증 완료)

### 1위: Conductor OSS — 스택 완벽 매칭 (Netflix 오리진)

- **GitHub**: https://github.com/conductor-oss/conductor
- **Stars**: 31,613 / Language: Java
- **마지막 활동**: 2026-04-10

**검증된 기술 스택 (build.gradle)**:
| 기술 | 버전 | 국내 매칭 |
|------|------|-----------|
| Spring Boot | 3.3.11 | O |
| Redis | Jedis, Redisson | O |
| Kafka | 3.5.1 | O |
| PostgreSQL | 42.7.2 + Flyway | O |
| Elasticsearch | 7/8 | O |
| Gradle | O | O |
| Java | 21 | O |

**도메인**: 워크플로우 오케스트레이션 — 분기/루프/재시도, Saga 패턴
**코드리뷰**: 2/5 (내부 팀 위주 머지)
**기여 진입점**: PostgreSQL persistence 모듈 쿼리 최적화, 새 태스크 타입 구현
**어필 문구**: "Conductor OSS (31K+ Stars, Netflix) 워크플로우 엔진에 PostgreSQL 영속성 레이어 최적화 및 Kafka 이벤트 큐 안정성 개선 기여"

---

### 2위: Apache SkyWalking — 종합 최고 (코드리뷰 우수)

- **GitHub**: https://github.com/apache/skywalking
- **Stars**: 24,769 / Language: Java
- **마지막 활동**: 2026-04-09

**검증된 기술 스택**:
| 기술 | 사용 | 국내 매칭 |
|------|------|-----------|
| Spring Boot | OAP Server | O |
| Kafka | fetcher plugin | O |
| MySQL / PostgreSQL | JDBC 스토리지 | O |
| Elasticsearch | 메트릭 스토리지 | O |
| Redis | X | - |
| JPA | X (직접 JDBC) | - |

**도메인**: 분산 트레이싱, 메트릭 집계, 토폴로지 분석
**코드리뷰**: **5/5** (PR당 4~9개 review comments)
**기여 진입점**: JDBC DAO 유닛 테스트 추가, 새 DB 스토리지 플러그인
**어필 문구**: "Apache SkyWalking (24K+ Stars) 분산 트레이싱 시스템에 JDBC 스토리지 레이어 개선 및 쿼리 최적화 기여. Apache 재단 코드리뷰 프로세스 충족"

---

### 3위: AxonFramework — 코드리뷰 압도적 1위

- **GitHub**: https://github.com/AxonFramework/AxonFramework
- **Stars**: 3,571 / Language: Java
- **마지막 활동**: 2026-04-09

**검증된 기술 스택**:
| 기술 | 사용 | 국내 매칭 |
|------|------|-----------|
| Spring | 핵심 통합 | O |
| Kafka | extension-kafka | O |
| JPA | 이벤트 스토어 | O |
| Redis | X | - |

**도메인**: CQRS, Event Sourcing, Saga, DDD
**코드리뷰**: **5/5** (PR당 32~56개 review comments — 조사한 30개 프로젝트 중 최고)
**기여 진입점**: EntityModule 리팩토링, Saga 오케스트레이션 개선
**어필 문구**: "AxonFramework (3.5K Stars) CQRS/이벤트 소싱 프레임워크에 Aggregate 라이프사이클 관리 및 Saga 오케스트레이션 로직 기여. DDD 아키텍처 설계 역량 증명"

---

### 4위: Camunda 8 — 진입 가장 쉬움

- **GitHub**: https://github.com/camunda/camunda
- **Stars**: 4,070 / Language: Java
- **마지막 활동**: 2026-04-10

**검증된 기술 스택**:
- Spring Boot 3/4 (starter 제공)
- Elasticsearch / OpenSearch
- BPMN 2.0, CMMN, DMN 엔진
- Maven, Java 17+

**도메인**: 프로세스 오케스트레이션, BPMN 엔진
**코드리뷰**: 4/5 (PR당 5~20개 review comments)
**기여 진입점**: **good-first-issue 30개!** — Operate FE 정렬 버그 (#45569), NPE 수정 (#42733)
**어필 문구**: "Camunda 8 클라우드 네이티브 BPM 엔진에 프로세스 오케스트레이션 엔진 및 API 레이어 기여. BPMN 2.0 표준 기반"

---

### 5위: Apache HertzBeat — 첫 기여 최적

- **GitHub**: https://github.com/apache/hertzbeat
- **Stars**: 7,158 / Language: Java
- **마지막 활동**: 2026-04-05

**검증된 기술 스택 (pom.xml)**:
| 기술 | 버전 | 국내 매칭 |
|------|------|-----------|
| Spring Boot | 4.0.3 | O |
| Kafka | 3.7.1 | O |
| MySQL + PostgreSQL | 지원 | O |
| Redis | 수집기 모듈 | O |
| Netty | 4.1.117 | - |

**도메인**: 에이전트리스 모니터링, 알림 규칙 엔진
**코드리뷰**: 2/5
**기여 진입점**: **good-first-issue 30개!** — 새 수집기(Collector) 구현, 모니터링 메트릭 추가
**어필 문구**: "Apache HertzBeat (7K+ Stars) 에이전트리스 모니터링 시스템에 데이터 수집기 및 메트릭 스토리지 레이어 기여"

---

### 6위: apolloconfig/apollo — 분산 설정 관리

- **GitHub**: https://github.com/apolloconfig/apollo
- **Stars**: 29,752 / Language: Java

**검증된 기술 스택 (pom.xml)**:
| 기술 | 사용 | 국내 매칭 |
|------|------|-----------|
| Spring Boot | 4.0.x | O |
| Spring Data JPA | O | O |
| MySQL | O | O |
| Spring Security | O | O |
| Spring Cloud | Eureka, Consul | O |

**도메인**: 분산 설정 관리, 그레이 릴리스, 네임스페이스
**코드리뷰**: 4/5 (PR #5585에서 24개 review comments)
**어필 문구**: "Apollo 분산 설정 관리 시스템 (29K+ Stars) Spring Boot 4 마이그레이션 관련 JPA 영속성 레이어 개선 기여"

---

### 7위: Apache ShardingSphere — 분산 DB 미들웨어

- **GitHub**: https://github.com/apache/shardingsphere
- **Stars**: 20,711 / Language: Java

**검증된 기술 스택**:
- MySQL / PostgreSQL (JDBC, Proxy 지원)
- ANTLR (SQL 파서), Calcite
- Maven, Java 8+

**도메인**: SQL 파싱, 샤딩 라우팅, 분산 트랜잭션
**기여 진입점**: **good-first-issue 30개!** — SQL 파서 관련 이슈 다수
**어필 문구**: "Apache ShardingSphere (20K+ Stars) 분산 SQL 미들웨어에 SQL 파싱 엔진 및 DB 샤딩 라우팅 로직 기여"

---

### 8위: Flowable Engine — BPM/워크플로우

- **GitHub**: https://github.com/flowable/flowable-engine
- **Stars**: 9,177 / Language: Java

**검증된 기술 스택 (pom.xml)**:
| 기술 | 사용 | 국내 매칭 |
|------|------|-----------|
| Spring Boot | starter 제공 | O |
| MyBatis | 내부 영속성 (핵심) | O |
| Hibernate | JPA 지원 | O |
| MySQL + PostgreSQL | 지원 | O |

**도메인**: BPMN, CMMN, DMN 엔진
**어필 문구**: "Flowable BPM 엔진 (9K+ Stars)에 BPMN 프로세스 실행 엔진 및 MyBatis 영속성 레이어 기여"

---

### 9위: Alibaba Nacos — 서비스 디스커버리

- **GitHub**: https://github.com/alibaba/nacos
- **Stars**: 32,817 / Language: Java

**검증된 기술 스택**: Spring Boot 3.4.10, MySQL + PostgreSQL, gRPC, Raft 합의
**도메인**: 서비스 디스커버리, 설정 푸시, 클러스터링
**어필 문구**: "Alibaba Nacos (32K+ Stars) 서비스 디스커버리 플랫폼에 분산 합의 프로토콜 및 설정 관리 로직 기여"

---

### 10위: Apache Fineract — 코어뱅킹 (금융 도메인)

- **GitHub**: https://github.com/apache/fineract
- **Stars**: 2,122 / Language: Java

**검증된 기술 스택 (build.gradle)**:
| 기술 | 버전 | 국내 매칭 |
|------|------|-----------|
| Spring Boot | 3.5.6 | O |
| JPA | EclipseLink 4.0.6 | △ (Hibernate 아님) |
| Kafka | 연동 가능 | O |
| LMAX Disruptor | 4.0.0 | - |
| Gradle | O | O |
| Java | 21 | O |

**도메인**: 대출, 예금, 회계, 이자 계산, 원장 관리
**코드리뷰**: 높음 (Apache 프로젝트)
**어필 문구**: "Apache Fineract 코어뱅킹 시스템에 대출 상환 스케줄 및 CQRS 커맨드 파이프라인 마이그레이션 기여"

---

## 추천 기여 조합 (3가지 전략)

### 전략 A: "스택 매칭 + 금융 도메인" (가장 현실적)

```
Fineract (코어뱅킹, Spring Boot + JPA)
  + Conductor OSS (워크플로우, Spring Boot + Redis + Kafka + PostgreSQL + Gradle)
```
- Fineract로 금융 비즈니스 로직 어필
- Conductor로 국내 대기업 풀 스택 매칭 어필

### 전략 B: "코드리뷰 성장 + Apache 타이틀" (성장 극대화)

```
Apache SkyWalking (관측성, PR리뷰 활발)
  + AxonFramework (CQRS/DDD, PR당 32~56 리뷰)
```
- 시니어 개발자 리뷰를 직접 받으며 성장
- "Apache Contributor" 타이틀 획득

### 전략 C: "빠른 첫 기여 → 점진적 확장" (진입 최적)

```
Apache HertzBeat (good-first-issue 30개)
  → Camunda 8 (good-first-issue 30개)
  → Conductor OSS (스택 완벽 매칭)
```
- HertzBeat로 Apache 기여 경험
- Camunda로 BPM 도메인 확장
- Conductor로 풀 스택 매칭

---

## 이력서 최종 어필 (전략 A + 기존 기여 합산)

> **오픈소스 기여**
> - **Apache Fineract** (2.1K Stars) — 코어뱅킹 시스템의 대출 상환 스케줄 로직 및 CQRS 커맨드 파이프라인 마이그레이션. Spring Boot 3.x + JPA
> - **Conductor OSS** (31K Stars, Netflix) — 워크플로우 엔진의 PostgreSQL 영속성 최적화 및 Kafka 이벤트 큐 안정성 개선. Spring Boot + Redis + Kafka + PostgreSQL
> - **Armeria** (5K Stars, LINE) — 비동기 RPC 프레임워크 기여. PR #6683 머지
> - **kotest** — Kotlin 테스트 프레임워크. type-safe assertion, Native IR 크래시 수정 등 6개 PR 머지
> - 총 10+ PR 머지, Apache/Netflix/LINE 등 글로벌 OSS 기여

---

## Kill Bill 평가 (참고용)

Kill Bill은 **국내 금융권 기술 스택과 적합도 ~15%**로 낮아 기여 우선순위를 낮춤:
- Guice DI → 국내 0% 사용
- JDBI → 국내 인지도 없음
- JAX-RS → Spring MVC에 밀려 사장
- OSGi → 국내 금융에서 전혀 미사용
- 도메인(구독빌링) → 코어뱅킹과 불일치

**분석 노트는 `PreAgile/killbill-notes` (private)에 보존**, 기여 우선순위는 다른 프로젝트로 전환.
