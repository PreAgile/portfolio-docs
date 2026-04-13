# 백엔드 시니어(5년차+) 이직 전략 V2

> **목표**: 한국 IT 빅테크(네이버, 라인, 카카오, 토스, 쿠팡, 우아한형제들, 당근, 무신사, 야놀자, 여기어때) 백엔드 시니어 포지션 지원
> **전략 핵심**: 실무 경험(Node.js/Python) + 오픈소스(Java/Kotlin/Spring) + 포트폴리오(재설계) = 완전 커버
> **작성일**: 2026-04-06
> **기반 데이터**: 10개사 JD 분석 + 기술블로그 깊이 분석 + cmong-be/mq/scraper/ml 심층 코드 분석

---

## 1. 현재 위치 진단

### 1-1. 보유 자산

**실무 프로젝트 4개 (Node.js/Python 기반):**

| 프로젝트 | 스택 | 시니어 레벨 경험 |
|---------|------|----------------|
| cmong-be | NestJS + TypeORM + MySQL + Redis + RabbitMQ | 결제 트랜잭션(15개 블록), 분산 락(SET NX+Lua), 옵티미스틱 락, 2계층 캐시, 이벤트 드리븐, 날짜 파티셔닝, 복합 인덱스 |
| cmong-mq | Python + FastAPI + MySQL + ThreadPoolExecutor | 동시성 제어(Lock+Queue), 4단계 에러 분류, DLQ 패턴, 세션 검증 캐시, 임계값 기반 알림 |
| cmong-scraper-js (분산 데이터 수집) | NestJS + Dual MySQL + Redis | 서킷 브레이커(적응형 트래픽 제어), 가중치 기반 라우팅(건강도 스코어링), 리소스 풀 30+ 인스턴스 관리, TLS 프로토콜 레벨 디버깅, 좀비 프로세스 탐지, Graceful Shutdown(Drain Mode) |
| cmong-ml | NestJS + TypeORM + Multi-LLM Provider | Provider 추상화(OpenAI/Google/Anthropic), Cache-First 패턴, 계층형 프롬프트, Zod 스키마 검증 |

**이미 작성된 문서:**
- ADR-001: Kafka vs RabbitMQ (900줄+, 실무 3경로 분석)
- ADR-002: Kotlin Coroutines vs Virtual Threads
- ADR-003: Cache Strategy (Cache-Aside + Stampede 방지)
- ADR-001 면접 대비 Q&A (600줄+)
- docker-compose.yml (Kafka, Redis, MySQL, Prometheus, Grafana, k6)

### 1-2. 치명적 갭

| 갭 | 심각도 | 현재 상태 |
|----|--------|----------|
| Java/Kotlin 실무 경험 | 치명적 | 0 — 모든 프로젝트가 Node.js/Python |
| Spring Boot/Framework 내부 이해 | 치명적 | NestJS DI/IoC 경험은 있으나 Spring 프록시 동작 모름 |
| JVM/GC 튜닝 | 높음 | 이론적 이해만 있고 실습 경험 없음 |
| JPA/Hibernate | 높음 | TypeORM 경험으로 ORM 개념은 있으나 영속성 컨텍스트, N+1 실전 경험 없음 |
| Kotlin Coroutine | 중간 | async/await, ThreadPoolExecutor 경험은 있으나 CPS 변환, Structured Concurrency 없음 |
| Kafka (RabbitMQ 경험은 있음) | 중간 | ADR-001에서 이론 정리 완료, 실전 코드 없음 |

---

## 2. 타겟 회사 분석 — 전체 JD 공통 요구사항

### 2-1. 10개사 JD 교집합 (필수)

**모든 회사가 공통으로 요구하는 것:**
- Java 또는 Kotlin + Spring Boot
- MySQL/RDBMS + SQL 설계
- Redis (캐시, 분산 락)
- REST API 설계
- 메시지 큐 (Kafka 또는 RabbitMQ)
- CS 기초 (자료구조, 알고리즘, OS, 네트워크)

### 2-2. 회사별 요구 깊이 티어

| 티어 | 회사 | 면접 특징 | 핵심 차별점 |
|------|------|----------|-----------|
| **S** | 라인, 네이버, 토스 | DFS식 꼬리질문 3~4단계 | JVM 내부, GC 알고리즘, Spring 프록시 동작, MVCC, 분산 락 원리까지. 라인은 커널 syscall/오픈소스 패치 레벨, 토스는 금융 정합성+운영 레질리언스 |
| **A** | 카카오, 쿠팡, 우아한형제들 | 시스템 설계 + 실무 경험 심화 | MSA 설계, 대용량 배치, Kafka 운영, DB 샤딩, Bar Raiser(쿠팡). 카카오는 자체 인프라 도구 구축(K8s Operator, 분산 스토리지), 우아한은 도메인 모델링+점진적 마이그레이션 |
| **B** | 당근, 야놀자 | 라이브코딩 + 경험 토론 | 당근은 Go+gRPC+Protobuf 중심 멀티스택, ADR 문화 정착, 무중단 마이그레이션 실전. 야놀자는 Kotlin+MSA+글로벌 SaaS 방향 |
| **C** | 무신사, 여기어때 | CS 기초 + 실무 경험 | 무신사는 NoSQL 마이그레이션+검색(ES) 중심, 여기어때는 멀티모듈+WebFlux+LGTM 옵저버빌리티 |

### 2-3. 기술블로그가 보여주는 시니어 합격선

기술블로그 분석 결과 3단계 깊이:
```
Layer 1 (탈락): "이 기술을 사용해봤다"
Layer 2 (합격선): "이런 문제가 있어서 이렇게 해결했다"
Layer 3 (시니어): "여러 선택지 중 이것을 선택한 이유와 트레이드오프"
Layer 4 (Staff+): "오픈소스/커널 레벨까지 추적해 근본 원인 해결" ← 라인/네이버급
```

---

#### 네이버 (d2.naver.com)

**블로그 특성**: 클래식 JVM/GC 시리즈가 한국 개발자 커뮤니티의 레퍼런스. 2023년 이후 순수 백엔드 글은 줄고 AI/ML 중심으로 재편됨.

| 주제 | 대표 글 | 깊이 |
|------|---------|------|
| JVM/GC 튜닝 | "Java Garbage Collection", "JVM Internal" 시리즈 | GC 알고리즘 내부(Mark-Sweep-Compact, G1 Region 구조), STW 메커니즘, JVM 힙 파라미터(-XX:SurvivorRatio, NewSize) 수준. **다만 2013-2019년 글이고 ZGC/JDK21+ 글은 없음** |
| Kafka | 네이버페이 주문 메시징 시스템 재설계 | 하루 3000만 건 메시지 발행, 무중단 마이그레이션 전략. **프로덕션 규모 운영 레벨** |
| DB 마이그레이션 | "스마트스토어센터 Oracle→MySQL 무중단 전환기" (2026.01) | **가장 최신 백엔드 글**. 프로덕션 무중단 DB 전환 실전 사례 |
| Virtual Thread | Virtual Thread 소개 글 | JVM 스레딩 모델(1:1 KLT-ULT 매핑 vs Virtual Thread) 수준. Carrier Thread/Pinning까지는 미확인 |
| 모니터링 | Pinpoint APM (자체 오픈소스), 지능형 로그 파이프라인 | 자체 APM 도구를 만들어 오픈소스화한 점이 특징적 |

**면접 타깃 깊이**: JVM/GC 클래식 글의 수준(알고리즘 내부 + 파라미터 튜닝)과 네이버페이 Kafka 글의 수준(프로덕션 규모 + 무중단 마이그레이션)이 벤치마크. Spring 내부 동작 글은 D2에 없으나, 면접에서는 프록시/트랜잭션 꼬리질문 3-4단계가 나온다는 점 주의.

---

#### 라인 (engineering.linecorp.com → techblog.lycorp.co.jp)

**블로그 특성**: **커널/JVM 레벨 디버깅 + Apache Kafka 직접 패치**까지 가는, 한국 IT 기업 중 가장 깊은 엔지니어링 글. Netty 창시자(Trustin Lee)가 재직하며 만든 Armeria 프레임워크 생태계.

| 주제 | 대표 글/발표 | 깊이 | 수치 |
|------|------------|------|------|
| 분산 Rate Limiter | "High-throughput distributed rate limiter" | Fixed-window 알고리즘, RxJava2 Completable 비동기 구현, Armeria+Central Dogma+Kafka 조합. **코드 수준 구현까지 공개** | **30만+ req/sec** |
| Kafka 대규모 운영 | Kafka Summit SF 발표 시리즈 | **Apache Kafka에 직접 패치 기여**: KAFKA-7504(sendfile(2) 시스콜이 네트워크 스레드 블로킹 → page cache 워밍업 기법으로 **50-100배 응답시간 개선**), KAFKA-4614(mmap Long GC pause 해결) | **일 250억 메시지**, 멀티테넌시 |
| JVM 성능 | "Kafka Broker Performance Degradation by Mysterious JVM Pause" | **ext4 저널링 데몬 → write(2) 시스콜 → safepoint sync 지연 → P99 SLO 위반** 체인 추적. GC 로그를 tmpfs로 리다이렉트하여 해결. **커널 writeback → jbd2 → page lock** 수준. 팀 내 OpenJDK 기여자 보유 | P99 < 40ms SLO |
| 스토리지 | "LINE Storage: Billions of rows in Sharded-Redis and HBase" | ZooKeeper 기반 클라이언트 샤딩, O(1)/O(n)/O(n*t) 복잡도 기반 저장 계층 결정 | **Redis 10,000+ 인스턴스, 50개 클러스터** |
| MSA | "Long road to microservices at LINE messaging platform" | LEGY 게이트웨이 → talk-server → Redis/HBase 구조 | **80억 일일 API, 피크 42만 msg/sec, 30,000+ 물리 서버** |
| 자체 프레임워크 | Armeria, Central Dogma, Decaton(Kafka 컨슈머) | Netty 기반 HTTP/2+gRPC+Thrift 단일 포트, 서킷 브레이커 내장 | Decaton: **100만 tasks/sec** |

**면접 타깃 깊이**: "왜 이렇게 동작하는가"를 커널 시스콜/JVM safepoint까지 추적하는 능력. **오픈소스 기여(Apache Kafka 패치)를 통한 근본 원인 해결** 스토리가 최강 시그널. Armeria를 분석해두면 라인 지원 시 직접적 이점.

---

#### 토스 (toss.tech)

**블로그 특성**: **금융 도메인 정합성**에 가장 깊은 글. 결제/원장/증권 실전 사례 + 구체적 수치. Kotlin Coroutine 자체 딥다이브보다 **도메인 문제 해결에 기술을 어떻게 적용했는가**에 집중.

| 주제 | 대표 글 | 깊이 | 수치 |
|------|---------|------|------|
| 결제 시스템 레거시 개편 | "20년 레거시를 넘어 미래를 준비하는 시스템 만들기" (시리즈) | Struts 1.2+Oracle 모놀리스 → Kotlin+Spring Boot 3.x+MySQL/PostgreSQL MSA. Strangler Fig 패턴 적용 | **150+ 마이크로서비스**, K8s 4개 가용영역 |
| 결제 원장 | "레거시 결제 원장을 확장 가능한 시스템으로" | **INSERT-only 원칙**, Outbox Pattern, Kafka 이벤트 발행, **멱등성 키** 이벤트 헤더, CDC 기반 Merge-on-Read | 수억 건 단위 INSERT |
| 캐시 전략 | "캐시를 적용하기까지의 험난한 길" | Look-aside 캐시 + Circuit Breaker + `@TransactionalEventListener(AFTER_COMMIT)` 조합. **0.003초 취약 구간**까지 분석 | 평균 **TPS 1만**, 최대 **TPS 2만** |
| Kafka DC 이중화 | Kafka 데이터센터 이중화 시리즈 | Active-Active 구성, 커스텀 Sink Connector(MirrorMaker2 미사용 — 이유와 트레이드오프 설명), 메시지 헤더로 무한 복제 루프 방지, DLQ | **1000+ 토픽** 운영, ClickHouse 메트릭 |
| Circuit Breaker | "토스는 Gateway 이렇게 씁니다", "해외주식 서비스 안정화" | Istio 인프라 레벨 + Resilience4j 앱 레벨 **이중 Circuit Breaker**. 자동 브로커 페일오버(분당 에러 100건×3분 → Kafka 이벤트 발행으로 자동 전환) | 미국장 오픈 시 **20배 TPS 급증** 대응 |
| 테스팅 | "가치있는 테스트를 위한 전략과 구현" | 4계층 테스트 전략, Classical vs Mockist 중 **실제 객체 선호**, Kotest DSL, ApprovalTests.Java(스냅샷 테스트). 커버리지 수치보다 **거짓 양성 방지** 중시 | - |
| ksqlDB | ksqlDB 시리즈 | CDC(MySQL/Oracle/MongoDB) → KTable, 30초 Tumbling Window, HyperLogLog 집계, 이상 탐지(2% 환율 변동) | **100+ 쿼리** 운영 |

**토스 엔지니어가 중시하는 가치** (블로그에서 드러남):
1. **정합성(Correctness)**: 멱등성, INSERT-only, Merge-on-Read → 데이터 불일치 = 금융 사고
2. **운영 레질리언스**: 자동 페일오버, 이중 Circuit Breaker, DC 이중화
3. **실용주의**: MirrorMaker2 대신 커스텀 커넥터, Oracle 대신 MongoDB 등 "운영 가능한 복잡도" 선택
4. **테스트 품질**: "어디를 테스트하지 않을 것인가"가 더 중요

**면접 타깃 깊이**: 결제 멱등성 키 설계, Outbox Pattern + CDC 파이프라인, 캐시 정합성 시나리오(0.003초 윈도우까지), Resilience4j 설정 근거. Kotlin Coroutine CPS 변환보다 **도메인 문제에 Coroutine을 어떻게 적용했는가**가 핵심.

---

#### 우아한형제들 (techblog.woowahan.com)

**블로그 특성**: **Before/After 실측 수치 공개**가 가장 적극적. DDD 실전 + 점진적 마이그레이션 + "안 쓰는 결정도 공유"하는 솔직한 톤.

| 주제 | 대표 글 | 깊이 | 수치 |
|------|---------|------|------|
| DDD/도메인 분리 | "전체 서비스를 관통하는 도메인 모듈을 안전하게 분리하기" (2025) | WMS에서 인바운드/재고/출고 3개 도메인을 **헥사고날 아키텍처로 분리**. Bounded Context 간 엔티티 참조 제거, QueryDSL 조인 금지, DTO만 반환. **27개 피처플래그**로 점진 배포 | **231개 API** 영향, 아키텍처 명확성 **4.14/5점** |
| Spring Batch | "누구나 할 수 있는 10배 더 빠른 배치 만들기", "Spring Batch와 Querydsl" | JPA N+1 해결, No-Offset 페이징 기법, 커스텀 ItemReader 오픈소스급 추상화 | **390분→30분 (13배)**, **119만 건 55분→2분27초 (22배)** |
| Kafka/이벤트 | "우리 팀은 카프카를 어떻게 사용하고 있을까", "회원시스템 이벤트기반 아키텍처" | Transactional Outbox + Debezium CDC, **3계층 이벤트 패턴**(ApplicationEvent / SNS-SQS / 외부 Zero-Payload). 이벤트 스토어 published 플래그 + 5분 후 자동 재발행 | **하루 100만+ 건 배달** |
| **Kafka를 안 쓰는 판단** | "Kafka 대신 RDB Task Queue" | 30분 초과 작업에서 max.poll.interval.ms 초과로 리밸런싱 발생 → Heartbeat 기반 RDB 큐로 전환. **"이 기술을 안 쓰는 이유"를 공유하는 점이 인상적** | - |
| Kotlin 도입 | "배민광고리스팅 개발기 (코프링+DSL+코루틴)" | Extension Function, Infix DSL, Operator Overloading 고급 기능 활용. **Coroutines MDC 전파를 위한 커스텀 AOP** 구현 | - |
| DB/분산락 | "MySQL 분산락으로 동시성 관리" | GET_LOCK/RELEASE_LOCK 기반, 커넥션 풀 이슈 해결 과정 **3단계 진화** | - |
| 무중단 마이그레이션 | "굴러가는 자동차에 안전하게 타이어 교체하기" | 조건부 분기 → Dual Write → 레거시 제거 3단계. Blue-Green이 아닌 **점진적 전환** | - |
| CQRS | "배민스토어에 이벤트 기반 아키텍처를 곁들인" | Command/Query 분리 + Zero Payload 패턴(이벤트에 ID만, HTTP로 최신 상태 조회) + DynamoDB/Redis 이중 저장소 | - |

**면접 타깃 깊이**: Outbox + CDC 파이프라인(ADR-004/005와 직결), No-Offset 배치 페이징, 3계층 이벤트 패턴, DDD Bounded Context 분리 실전. "왜 Kafka를 안 썼는가" 같은 **반대 결정의 트레이드오프**도 설명할 수 있어야 함.

---

#### 카카오 (tech.kakao.com)

**블로그 특성**: **자체 인프라 도구 구축** 글이 독보적(K8s Operator, 분산 스토리지, 프로비저닝 툴). 2023년 이후 Kakao Tech Meet/if(kakaoAI) 영상 의존도가 높아져 블로그 글 자체는 얕아지는 추세.

| 주제 | 대표 글 | 깊이 | 수치 |
|------|---------|------|------|
| K8s Operator | "쿠버네티스에 레디스 캐시 클러스터 구축기" | CRD 정의, reconcile 메커니즘, 롤백용 스택 기반 Action 관리. Operator 설계 패턴 상세 | **약 5,000개 파드** |
| K8s 프로비저닝 | "쿠버네티스 프로비저닝 툴과의 만남부터 헤어짐까지" | Kubespray/Cluster API/Kubeadm 비교 후 자체 도구 개발 | 컨트롤 플레인 **700초→200초 (70%↓)**, 데이터 플레인 **180초→10초 (95%↓)**, 수백 개 클러스터, **수만 대 노드** |
| etcd/Raft | "Kubernetes etcd 동작 원리" | **Raft 합의 알고리즘** 수준까지 설명 | - |
| 분산 스토리지 | "Object Storage 분산 Radix Tree" (2022) | 자체 분산 자료구조 설계, Bloom Filter 탐색 최적화, 4KB 노드 스플릿. **학술 논문 인용 수준** | 분산 스토리지 Kage: **수천억 개 파일, 수백 TB**, 3중 복제 |
| Kafka | "카카오 공용 Message Streaming Platform", kafka-sink-connector 오픈소스 | Kafka+RabbitMQ 이중 운영, SinkTask 구현 코드/JSONPath 필터링/linger.ms·batch.size 튜닝 공개 | - |
| Redis | Redis 캐시 클러스터 + "Redis SCAN 동작 원리" | 호스트 네트워크 모드 선택, 자동 failover, Pod Affinity HA. SCAN 내부 해시 테이블 순회 알고리즘 | - |
| 안정성 | 안정성 보고서 시리즈 (2024) | MTTR 기반 장애 측정, 다중 DC 분산, 카나리/블루-그린 배포 | **4천만 사용자**, 카카오톡 채팅 서버 **하루 11회 배포** |

**주의**: 카카오페이/카카오뱅크는 **별도 기술블로그**(tech.kakaopay.com, tech.kakaobank.com)로 분리. tech.kakao.com만으로는 금융 도메인 깊이를 볼 수 없음.

**면접 타깃 깊이**: K8s Operator 설계 패턴, etcd Raft 알고리즘, Redis 클러스터 운영(failover, 슬롯 할당), Kafka 공용 플랫폼 구축 경험. 인프라 자체 도구를 설계/구축할 수 있는 수준.

---

#### 쿠팡 (medium.com/coupang-engineering)

**블로그 특성**: 발행 빈도는 낮지만(2024년 10-11월 집중 10편), **인프라 스케일 수치**를 적극 공개. 자체 프레임워크(Vitamin) 구축. CQRS/Event Sourcing/Vitess 관련 글은 외부 미공개.

| 주제 | 대표 글 | 깊이 | 수치 |
|------|---------|------|------|
| 대용량 캐시 전략 | "대용량 트래픽 처리를 위한 백엔드 전략" | 2계층 캐시(read-through+realtime), 로컬 캐시로 스파이크 시 70% 흡수, 서킷브레이커, TCP 모니터링 1초 주기 장애 감지 | **분당 1억 요청**, 캐시 노드 60-100개, **P95 500ms→100ms 미만** |
| Data Serving Layer | "Data Serving Layer 운영 교훈" | non-blocking I/O 전환, sticky→random routing으로 트래픽 불균형 해소 | **CPU 50%+ 감소**, 트래픽 편차 **5-10배→균등** |
| MSA 전환 | "How Coupang Built a Microservice Architecture" | 2013년 모놀리스 분해 과정, 자체 Vitamin 프레임워크 | **1800만 고객** |
| 공간 인덱스 | "로켓배송 공간 인덱스 시스템" | Uber H3 채택(S2 대비 트레이드오프 분석), 14레벨 해상도 | 한국 전역 **217억 헥사곤** |

**면접 타깃 깊이**: **시스템 디자인 면접 비중이 가장 높음**. 캐시 2계층 설계, 장애 감지/복구, 트래픽 분산 알고리즘 등을 화이트보드에 그릴 수 있어야 함. Bar Raiser 면접에서 "왜 이 설계인가?" 꼬리질문 대비 필수.

---

#### 당근 (medium.com/daangn)

**블로그 특성**: **실용주의 + ADR 문화 + 솔직한 톤**. 인턴도 글을 쓰고, 마이그레이션에 "1년 넘는 기간"이 걸렸다고 현실적 타임라인 공유. Go+gRPC+Protobuf 멀티스택.

| 주제 | 대표 글 | 깊이 | 수치 |
|------|---------|------|------|
| MSA 전환 | "회원 시스템 MSA 전환 도전기" | Ruby on Rails→MSA 무중단 마이그레이션. **8단계 순차 전환**, 각 단계마다 API 설계→Dual Write→Shadow Traffic→점진적 롤아웃 4단계 프로세스. **자체 경량 HTTP 프록시** 구현, 마이그레이션 파이프라인 6컴포넌트 | **MAU 1,900만**, 가용성 **99.999%**, 정합성 편차 **0.001%** |
| 아키텍처 | "아키텍처에 대한 고민은 처음이라" (2024) | Hexagonal Architecture 실전 적용. gRPC/HTTP/Kafka 다중 인터페이스 처리. ADR 기반 의사결정 | - |
| 이벤트 시스템 | "이벤트센터 개발기" | GCP Pub/Sub+Dataflow 기반, 실시간 스트리밍 검증, 단기 윈도우 중복제거, DLQ, CLI 코드 자동생성(Swift/Kotlin/TypeScript) | - |

**면접 타깃 깊이**: 무중단 마이그레이션 실전 전략, 아키텍처 선택 근거(ADR), 이벤트 드리븐 설계. **"왜 이 복잡도가 적절한가"**에 대한 실용적 판단이 핵심. 컬쳐핏 비중이 높아 기술 외 소프트 스킬도 중요.

---

#### 무신사 (medium.com/musinsa-tech)

**블로그 특성**: 간헐적 발행. NoSQL 마이그레이션과 검색(Elasticsearch) 중심. 이커머스 도메인(상품, 검색, 물류) 편중.

| 주제 | 대표 글 | 수치 |
|------|---------|------|
| NoSQL 마이그레이션 | "NoSQL 도입 여정" 1/2편 | DocumentDB→Couchbase. **Insert 658초→53초 (12배)**, Delete 45초→3.8초 |
| 검색 인프라 | "MusE (Musinsa Elasticsearch)" | ES 5.x→8.x 4세대 진화 |
| 테스트 | "리팩토링을 위한 통합 테스트" | WMS/OMS 물류 시스템 테스트 전략 |

**면접 타깃 깊이**: Spring 기본기 + DB 마이그레이션 경험 + 성능 개선 수치. S-tier 대비 **70% 수준**.

---

#### 야놀자 (yanolja.github.io)

**블로그 특성**: 기술블로그가 3곳(GitHub Pages, Medium/yanolja, Medium/yanoljacloud-tech)에 분산되어 있고, **최근 백엔드 심층 글이 거의 없음**. 채용 공고의 기술 스택(Kotlin+MSA+이벤트 드리븐)은 화려하지만 블로그로 검증 불가.

**면접 타깃 깊이**: 채용 공고 기준 Kotlin+MSA+이벤트 드리븐 경험 요구. 글로벌 SaaS(야놀자클라우드) 방향. S-tier 대비 **30% 수준** (블로그 기준).

---

#### 여기어때 (techblog.gccompany.co.kr)

**블로그 특성**: 셋(무신사/야놀자/여기어때) 중 가장 꾸준한 발행. 실무 밀착형 글이 특징.

| 주제 | 대표 글 |
|------|---------|
| 아키텍처 | "멀티모듈 프로젝트, 왜 그리고 어떻게" — 클린 아키텍처 기반 모듈 분리 |
| API 전환 | "전시 API 서비스 전환기" |
| 옵저버빌리티 | "Observability를 위한 LGTM 첫걸음" — Loki+Grafana+Tempo+Mimir |
| CI/CD | "CI/CD 개선기" — Jenkins→EKS 컨테이너화 |

**면접 타깃 깊이**: 멀티모듈 설계 + Spring WebFlux + LGTM 옵저버빌리티. Kafka/분산 트랜잭션 심층은 부재. S-tier 대비 **50% 수준**.

---

#### 전체 비교: 회사별 블로그 엔지니어링 깊이 매트릭스

| 영역 | 라인 | 네이버 | 토스 | 우아한 | 카카오 | 쿠팡 | 당근 | 무신사 | 야놀자 | 여기어때 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| JVM/GC | ★★★★★ | ★★★★ | ★★ | ★★ | ★★ | ★★ | ★ | ★ | - | ★ |
| Kafka | ★★★★★ | ★★★ | ★★★★ | ★★★★ | ★★★ | ★★ | ★★ | ★ | - | ★ |
| DB 최적화 | ★★★ | ★★★ | ★★★ | ★★★★ | ★★★ | ★★★ | ★★ | ★★★ | - | ★★ |
| 분산 시스템 | ★★★★★ | ★★ | ★★★★ | ★★★ | ★★★★ | ★★★★ | ★★★ | ★ | - | ★ |
| 도메인 설계 | ★★ | ★★ | ★★★★ | ★★★★★ | ★★ | ★★ | ★★★ | ★★ | - | ★★ |
| 인프라/K8s | ★★★ | ★★ | ★★ | ★★ | ★★★★★ | ★★★ | ★★ | ★ | - | ★★ |
| 테스트 문화 | ★★ | ★ | ★★★★ | ★★★ | ★★ | ★ | ★★ | ★★ | - | ★ |
| 수치 공개 | ★★★★★ | ★★★ | ★★★★ | ★★★★★ | ★★★★ | ★★★★ | ★★★ | ★★★ | - | ★ |

---

## 3. 3축 전략

```
축 1: 실무 스토리 (이미 있음 → Layer 3으로 정제)
  → EXPERIENCE-STORIES.md 참고
  → 7개 핵심 에피소드를 "문제→선택지→트레이드오프→결정→결과"로 구조화

축 2: 오픈소스 (Java/Kotlin/Spring 갭 메우기)
  → Spring Boot, Resilience4j, Redisson 등 분석/기여
  → "소스코드 레벨에서 이해하고 있다"를 증명

축 3: 포트폴리오 프로젝트 (resume/projects/)
  → Java/Kotlin + Spring Boot + Kafka + JPA로 실무 문제 재설계
  → 실측 수치(k6, EXPLAIN, GC 로그)로 증명
```

---

## 4. Phase별 실행 계획

### Phase 0: 기반 구축 (1주, 즉시 시작)

**목표: 문서 정리 + Spring 프로젝트 스켈레톤**

#### 4-0-1. 실무 스토리 문서화
- [ ] `EXPERIENCE-STORIES.md` 작성 — 7개 에피소드 초안
- [ ] 각 에피소드에 "Java/Spring에서는 어떻게 대응되는가" 섹션 추가
- [ ] 각 에피소드에 "꼬리질문 3단계 방어 스크립트" 추가

#### 4-0-2. platform-api 스켈레톤
- [ ] Spring Boot 3.x + Kotlin + JPA + MySQL + Redis 프로젝트 생성
- [ ] 기본 엔티티 설계: User, Subscription, Billing, Coupon (cmong-be 결제 도메인 기반)
- [ ] `@Transactional` 기본 동작 확인 + LEARNING-LOG 기록
- [ ] Testcontainers + JUnit5 통합 테스트 1개 작성

#### 4-0-3. 이론 공부 시작
- [ ] "Real MySQL 8.0" 1~5장 읽기 (인덱스, 실행계획)
- [ ] Spring 공식 문서: Transaction Management 섹션 정독
- [ ] JVM 메모리 구조 다이어그램 직접 그려보기 (Heap/Stack/Metaspace)

#### Phase 0 공부법
```
매일 루틴 (총 3~4시간):
├─ 오전 30분: "Real MySQL" 1장씩
├─ 점심시간: Spring 공식 문서 30분 (Transaction, Bean Lifecycle)
├─ 퇴근 후 2시간: platform-api 코드 작성
└─ 취침 전 30분: LEARNING-LOG 기록 + 다음 날 할 일 정리
```

---

### Phase 1: 핵심 구현 + Java/Spring 기초 체화 (2~3주)

**목표: 포트폴리오 핵심 기능 구현 + Spring 내부 동작 이해**

#### 4-1-1. platform-api 결제 도메인 구현
- [ ] 결제 트랜잭션: `@Transactional` + 옵티미스틱 락 (`@Version`)
  - cmong-be의 QueryRunner 패턴을 Spring `@Transactional(propagation=REQUIRES_NEW)`로 변환
  - 쿠폰 적용 실패 시 부분 롤백 시나리오 테스트
- [ ] 멱등성 키: `IdempotencyKey` 엔티티 + 유니크 제약조건
  - cmong-be의 웹훅 중복 체크(merchant_uid+status+imp_uid)를 정식 멱등성 키로 발전
- [ ] Redis 분산 락: Redisson으로 구현
  - cmong-be의 SET NX + Lua 스크립트와 비교하는 ADR-004 작성
- [ ] 복합 인덱스 설계 + `EXPLAIN ANALYZE` 결과 기록
  - cmong-be의 `idx_user_platform_covering` 같은 커버링 인덱스를 JPA `@Index`로

#### 4-1-2. platform-event-consumer Kafka 연동
- [ ] Spring Kafka Consumer 기본 구현
  - cmong-mq의 RabbitMQ Consumer를 Kafka로 전환
  - Manual Commit (`AckMode.MANUAL_IMMEDIATE`)
- [ ] Transactional Outbox Pattern 구현
  - cmong-be의 EventEmitter2 이벤트를 Outbox 테이블로 전환
  - `SELECT FOR UPDATE SKIP LOCKED` 기반 Relay
- [ ] Idempotent Consumer 구현
  - `processed_events` 테이블 + 같은 트랜잭션에서 비즈니스 로직 + 멱등성 체크
- [ ] Dead Letter Topic(DLT) 설정
  - cmong-mq의 MqErrorLogs 테이블 패턴을 Kafka DLT로

#### 4-1-3. Spring 내부 동작 공부
- [ ] `@Transactional` 프록시 동작 소스 분석
  - `TransactionInterceptor` → `PlatformTransactionManager` 흐름
  - self-invocation 문제 이해 + 테스트 코드로 확인
- [ ] Bean 라이프사이클: `@PostConstruct` → `InitializingBean` → `@PreDestroy`
  - cmong-be의 `onApplicationShutdown()` 훅과 비교
- [ ] AOP 프록시: JDK Dynamic Proxy vs CGLIB
  - NestJS의 Interceptor와 비교하며 이해

#### 4-1-4. DB 심화 공부
- [ ] MySQL 인덱스 내부 구조 (B+Tree)
  - "Real MySQL" 8~10장: 인덱스, 실행계획, 최적화
  - cmong-be의 복합 인덱스들을 EXPLAIN으로 분석한 결과 문서화
- [ ] 트랜잭션 격리 수준 4단계 실습
  - REPEATABLE READ에서 팬텀 리드가 왜 발생하지 않는지 (갭 락)
  - cmong-be가 기본 격리 수준(MySQL REPEATABLE READ)을 쓴 이유
- [ ] MVCC 동작 원리
  - undo log, read view 개념
  - "왜 REPEATABLE READ에서 동일 트랜잭션 내 같은 결과를 보는가?"

#### Phase 1 공부법
```
매일 루틴 (총 4~5시간):
├─ 오전 1시간: "Real MySQL" + EXPLAIN 실습 (MySQL 로컬에서 직접 쿼리)
├─ 점심시간: Spring 소스코드 읽기 30분
│   (TransactionInterceptor.java, AbstractPlatformTransactionManager.java)
├─ 퇴근 후 2~3시간: platform-api/event-consumer 코드 작성
│   - 월~수: 결제 도메인 (트랜잭션, 락, 멱등성)
│   - 목~금: Kafka Consumer (Outbox, Idempotent Consumer)
└─ 주말: ADR 작성 + 면접 Q&A 업데이트 + LEARNING-LOG 정리
```

**이 Phase에서 회사에서 할 것:**
- cmong-be 결제 모듈에 **멱등성 키 정식 도입** → 실무 경험으로 전환
- cmong-be의 느린 대시보드 쿼리에 `EXPLAIN ANALYZE` 돌리고 결과 기록 → 인덱스 튜닝 근거
- cmong-be TypeORM 커넥션 풀 설정 명시적으로 튜닝 → HikariCP와 비교 학습

---

### Phase 2: 차별화 + 깊이 확보 (4~6주)

**목표: 시니어 레벨 증명 (수치, 오픈소스, JVM)**

#### 4-2-1. 부하 테스트 & 실측 수치
- [ ] k6 부하 테스트 실행 (platform-api)
  - 캐시 히트/미스 시나리오별 TPS, P95, P99 측정
  - HikariCP 커넥션 풀 사이즈별 성능 비교
  - 결과를 README에 실측값으로 기록
- [ ] 장애 주입 테스트
  - `docker stop kafka` → Consumer Lag 변화 + 복구 시간 측정
  - `docker stop redis` → 캐시 미스 폭증 시 DB 부하 측정
  - Circuit Breaker 동작 확인
- [ ] Consumer Lag 모니터링
  - Grafana 대시보드 구성 + 스크린샷
  - Lag-TPS 상관관계 실측

#### 4-2-2. async-crawler 구현 (분산 데이터 수집 패턴을 Java/Kotlin으로)
- [ ] Kotlin Coroutine + Spring Batch
  - 실무 분산 수집 시스템의 동시성 패턴을 Coroutine으로 재설계
  - `withContext(Dispatchers.IO)` 블로킹 I/O 격리
  - `SupervisorJob` 장애 격리
- [ ] Resilience4j 서킷 브레이커
  - 실무에서 직접 구현한 적응형 트래픽 제어를 Resilience4j로 재구현
  - 설정값(에러 임계값 50%/30%/15%, 슬로우콜 120초) 근거 문서화
- [ ] Rate Limiting
  - Token Bucket 알고리즘 구현
  - 플랫폼별 차등 Rate Limit

#### 4-2-3. 오픈소스 분석 & 기여
- [ ] **Spring Boot** 이슈/PR 탐색
  - Auto Configuration 동작 원리 소스 분석
  - 문서 개선, 테스트 추가, 버그 수정 중 하나로 첫 PR
- [ ] **Resilience4j** 소스 분석
  - CircuitBreaker 상태 머신 구현 읽기
  - cmong-scraper 서킷 브레이커와 비교 → LEARNING-LOG 기록
- [ ] **Redisson** 소스 분석
  - RedLock 알고리즘 구현 읽기
  - cmong-be의 SET NX + Lua와 비교 → ADR-004에 반영

#### 4-2-4. JVM 심화 공부
- [ ] GC 알고리즘 비교 실습
  - G1GC vs ZGC: `-XX:+UseG1GC` / `-XX:+UseZGC` 플래그 교체 후 벤치마크
  - `jstat -gcutil` 로 GC 빈도/시간 측정
  - GC 로그 분석: `-Xlog:gc*:file=gc.log`
- [ ] JVM 프로파일링
  - Async-Profiler로 CPU flame graph 생성
  - 힙 덤프 분석: `jmap -dump:live,format=b,file=heap.hprof`
  - MAT(Memory Analyzer Tool)로 메모리 누수 탐지 실습
- [ ] Java 동시성 심화
  - `synchronized` vs `ReentrantLock` 벤치마크 코드 작성
  - `volatile`의 happens-before 관계 테스트
  - `ConcurrentHashMap` Java 8 소스 분석 (세그먼트 → 노드 단위 CAS)
  - `CompletableFuture` 체이닝 — cmong-mq ThreadPoolExecutor를 Java로 재구현

#### Phase 2 공부법
```
매일 루틴 (총 4~5시간):
├─ 오전 1시간: JVM/GC 실습 (jstat, GC 로그, 프로파일링)
│   - 주 1~2: G1GC 이해 + 로그 분석
│   - 주 3~4: ZGC + Async-Profiler
│   - 주 5~6: Java 동시성 코드 작성
├─ 점심시간: 오픈소스 소스코드 읽기 30분
│   - Spring Boot TransactionAutoConfiguration
│   - Resilience4j CircuitBreakerStateMachine
│   - Redisson RedissonLock
├─ 퇴근 후 2~3시간: async-crawler 코드 + k6 테스트
│   - 월~수: Coroutine + Batch 구현
│   - 목~금: k6 부하 테스트 + 수치 기록
└─ 주말: 오픈소스 PR 작업 + Grafana 대시보드
```

**이 Phase에서 회사에서 할 것:**
- cmong-be 대시보드 집계 배치 최적화 실행 → EXPLAIN 결과 Before/After 기록
- 분산 수집 시스템 서킷 브레이커 설정값 근거 문서화 → 면접 스토리 소재
- cmong-mq 에러 분류 체계를 더 정교하게 → Severity 기반 자동 복구 강화

---

### Phase 3: 마무리 + 면접 준비 (7~10주)

**목표: 이력서 완성 + 면접 시뮬레이션**

#### 4-3-1. 포트폴리오 마무리
- [ ] 3개 프로젝트 README 완성 (실측 수치만)
- [ ] GitHub Actions CI 파이프라인
- [ ] Grafana 대시보드 스크린샷 (Consumer Lag, TPS, P99, GC 메트릭)
- [ ] 전체 아키텍처 다이어그램 (Mermaid)

#### 4-3-2. 면접 에피소드 완성
- [ ] 7개 에피소드 스크립트 최종본
  - 각 에피소드: 3분 설명 + 꼬리질문 3~4단계 방어
  - Java/Spring 대응 코드 포함
- [ ] 회사별 맞춤 면접 준비
  - 토스: Kotlin Coroutine + 결제 멱등성 + 테스트 코드 품질
  - 우아한: DDD + Spring Batch + 대용량 배치
  - 라인: JVM 튜닝 + 분산 시스템 + 영어
  - 쿠팡: 시스템 디자인 + Bar Raiser + 샤딩
  - 네이버: CS 기초 원리 + JVM + 대규모 트래픽

#### 4-3-3. CS 기초 복습 (약한 부분 집중)
- [ ] HashMap 내부 구조 (Java 8 Red-Black Tree 전환: 8개 이상 + capacity 64 이상)
- [ ] TCP 3-way/4-way handshake + TLS 1.3 핸드셰이크
- [ ] 프로세스 vs 스레드 vs 코루틴 계층 정리
- [ ] 가상 메모리, 페이지 폴트, 컨텍스트 스위칭 비용

#### 4-3-4. 모의 면접
- [ ] 기술 면접 시뮬레이션 (1주 2회)
  - 에피소드 발표 → 꼬리질문 → 답변 → 녹음 → 리뷰
- [ ] 시스템 디자인 연습 (1주 1회)
  - "결제 시스템 설계", "실시간 배차 시스템", "쿠폰 선착순 시스템"
- [ ] 코딩 테스트 (1일 1문제)
  - 프로그래머스 Level 2~3 / LeetCode Medium

#### Phase 3 공부법
```
매일 루틴 (총 3~4시간):
├─ 오전 1시간: 코딩 테스트 1문제 (프로그래머스/LeetCode)
├─ 점심시간: CS 기초 복습 30분 (노트 정리)
├─ 퇴근 후 1~2시간: 면접 에피소드 스크립트 작성 + 시뮬레이션
│   - 월: 에피소드 1~2 연습
│   - 화: 에피소드 3~4 연습
│   - 수: 에피소드 5~7 연습
│   - 목: 시스템 디자인 연습
│   - 금: 포트폴리오 README/문서 보강
└─ 주말: 모의 면접 + 피드백 반영 + 이력서 업데이트
```

---

### Phase 4: 지원 & 이터레이션 (11주~)

**목표: 실제 지원 + 면접 피드백 반영**

#### 4-4-1. 지원 순서 전략

| 순서 | 회사 | 이유 |
|------|------|------|
| 1차 (연습) | 무신사, 여기어때 | 면접 난이도 낮음, 실전 경험 축적 |
| 2차 (중간) | 야놀자, 당근 | 중간 난이도, 컬쳐핏 비중 높아 소프트 스킬 테스트 |
| 3차 (목표) | 토스, 우아한, 카카오페이 | 결제/금융 도메인 직접 매핑 |
| 4차 (도전) | 라인, 네이버, 쿠팡 | 가장 깊은 기술 면접 |

#### 4-4-2. 면접 후 피드백 루프
```
면접 → 질문 기록 → 못 답한 것 분석 → 공부 → LEARNING-LOG 기록 → 다음 면접
```

---

## 5. 오픈소스 전략 상세

### 5-1. 현재 오픈소스 기여 현황 (2026-04-06 기준)

**이미 머지된 외부 오픈소스 PR: 10개**

| 프로젝트 | PR 수 | 유형 | 핵심 내용 | JD 매핑 |
|---------|:---:|------|----------|---------|
| **kotest/kotest** | 6개 | feat 4 + fix 2 | type-safe assertion, JsonSchema DSL anyOf/oneOf, collection data class diff, chainable matchers, native IR crash fix | **Kotlin 테스트 생태계 깊이** — 토스/우아한/당근 |
| **sksamuel/hoplite** | 1개 | fix | strict mode prefix key 버그 수정 | **Kotlin 설정 라이브러리** — Kotlin 생태계 이해 |
| **spring-cloud/spring-cloud-gateway** | 1개 | docs | CONTRIBUTING.md DCO 업데이트 | **Spring Cloud 생태계 진입** — 전사 공통 |
| **testcontainers/testcontainers-java** | 1개 | docs | k6 문서 개선 | **Java 테스트 인프라** — 전사 공통 |
| **taskforcesh/bullmq** | 1개 | feat | sandboxed processor getDependenciesCount 프록시 추가 | **MQ 라이브러리** — 메시지 큐 깊이 |

**+ 개인 Kotlin 프로젝트:**
| 프로젝트 | 설명 |
|---------|------|
| **PreAgile/KSentinel** | Kotlin 기반 프로젝트 (3개 PR 머지) |

### 5-2. 강점 분석

**이미 확보된 것:**
- **Kotlin 생태계 깊이**: kotest 6개 PR (기능 추가 + 버그 수정) → "Kotlin 코드를 읽고 쓸 수 있다"의 강력한 증거
- **테스트 문화**: kotest + testcontainers 기여 → "테스트에 진심인 개발자" 시그널 (토스가 특히 중시)
- **Spring 생태계 진입**: spring-cloud-gateway PR → docs 레벨이지만 Spring 오픈소스에 기여한 이력
- **크로스스택 능력**: bullmq(Node.js) + kotest(Kotlin) + testcontainers(Java) → 다양한 생태계 기여

**아직 부족한 것:**
- Spring Boot/Framework **코드 레벨** PR (현재는 docs만)
- 분산 시스템 관련 오픈소스 (Resilience4j, Redisson 등) 기여
- 성능/인프라 관련 오픈소스 (HikariCP 등) 기여

### 5-3. 수정된 오픈소스 전략 — 기존 기여를 살리면서 갭 메우기

#### Tier 1: 즉시 — 기존 기여 강화 (이미 컨트리뷰터인 프로젝트)

| 대상 | 현재 | 다음 목표 | 면접 활용 |
|------|------|----------|----------|
| **kotest** | 6 PR 머지 (feat+fix) | **코어 기능 PR 1~2개 추가** — 예: kotest-extensions-spring 개선, coroutine 테스트 지원 강화 | "Kotlin 테스트 프레임워크에 6개 이상 기여. type-safe assertion 설계부터 native IR 크래시 디버깅까지" |
| **spring-cloud-gateway** | 1 PR (docs) | **코드 레벨 PR 시도** — filter 로직 개선, 테스트 추가, 버그 수정 | "Spring Cloud 생태계에 코드 기여. Gateway filter chain 내부 동작을 이해" |
| **testcontainers-java** | 1 PR (docs) | **Kafka/Redis 모듈 테스트 개선** | "Testcontainers 기여 경험으로 통합 테스트 인프라에 깊은 이해" |

#### Tier 2: 단기 (2~4주) — 갭 메우기 신규 타겟

| 대상 | 왜 이것인가 | 실무 연결점 | 목표 |
|------|-----------|-----------|------|
| **Resilience4j** | 서킷 브레이커 — 실무 분산 수집 시스템의 적응형 트래픽 제어와 직결 | "직접 구현한 서킷 브레이커와 비교 분석" | 소스 분석 + 이슈/PR 1개 |
| **Redisson** | Redis 분산 락 — cmong-be SET NX+Lua와 직결 | "Lua로 직접 구현 vs Redisson RedLock 비교" | 소스 분석 + 문서/테스트 PR |
| **Spring Boot** (core) | @Transactional 프록시, Auto Configuration | "Spring 내부 동작을 소스 레벨에서 이해" | 소스 분석 (PR 선택적) |

#### Tier 3: 중기 (5~8주) — 차별화

| 대상 | 왜 이것인가 | 타겟 회사 |
|------|-----------|---------|
| **Armeria** (LINE 오픈소스) | Netty 기반 비동기 서버. LINE 지원 시 강력한 시그널 | 라인 |
| **HikariCP** | 커넥션 풀 내부 동작. 성능 튜닝 근거 | 네이버, 쿠팡 |
| **Spring Kafka** | Kafka Consumer/Producer 심화 | 카카오, 토스 |

### 5-4. 오픈소스 → 면접 스토리 변환 패턴

**기존 kotest 기여를 활용하는 패턴:**
> "Kotlin 테스트 프레임워크인 kotest에 6개 PR을 기여했습니다.
> 특히 type-safe shouldEq assertion을 설계할 때, Kotlin의 타입 시스템(reified generics, 
> OnlyInputTypes)을 깊이 이해해야 했고, native IR 컴파일러 크래시를 디버깅하면서
> Kotlin 멀티플랫폼 빌드 파이프라인까지 파악하게 됐습니다."

**새로운 Spring 기여를 활용하는 패턴:**
> "NestJS에서 데코레이터 기반 DI를 사용했는데, Spring은 프록시 기반이라 self-invocation에서
> @Transactional이 동작하지 않는 차이가 있습니다. spring-cloud-gateway에 기여하면서
> Spring의 filter chain과 AOP 프록시 구조를 코드 레벨에서 이해했고,
> 이 차이를 포트폴리오에서 TransactionTemplate으로 해결했습니다."

**크로스스택 능력을 활용하는 패턴:**
> "Node.js MQ 라이브러리(bullmq)와 Kotlin 테스트 프레임워크(kotest), 
> Java 테스트 인프라(testcontainers)에 각각 기여한 경험이 있습니다.
> 여러 생태계를 넘나들면서 '같은 문제를 다른 언어/프레임워크에서 어떻게 해결하는가'를
> 비교하는 관점을 갖게 됐고, 이것이 기술 선택 시 트레이드오프 판단에 도움이 됩니다."

---

## 6. 이력서 구성 설계

```
[1] 핵심 역량 요약
  → "분산 시스템 설계 (분산 락, 이벤트 드리븐, 서킷 브레이커)"
  → "결제/트랜잭션 시스템 (멱등성, 옵티미스틱 락, 다단계 트랜잭션)"
  → "대용량 데이터 처리 (배치 최적화, 인덱스 튜닝, 파티셔닝, 캐싱)"
  → "Java/Kotlin + Spring 오픈소스 분석 | Node.js/Python 크로스스택"

[2] 실무 경험 — 각 에피소드 1~2줄 요약 + 수치
  → EXPERIENCE-STORIES.md 참고

[3] 포트폴리오 (Java/Kotlin 재설계)
  → platform-api: "결제 트랜잭션 + 멱등성 + 분산 락 (P99 Xms, TPS X)"
  → platform-event-consumer: "Kafka + Outbox + 멱등 컨슈머 (Consumer Lag X건 → Xms 복구)"
  → async-crawler: "Coroutine + 서킷 브레이커 + Spring Batch (처리량 X건/분)"

[4] 오픈소스 기여
  → Spring Boot / Resilience4j / Redisson

[5] 기술 깊이 증명
  → ADR 문서 (설계 의사결정 근거)
  → k6 부하 테스트 결과
  → Grafana 모니터링 대시보드
```

---

## 7. 회사에서 병행할 실무 개선 목록

이력서에 "현 직장에서 이런 개선을 주도했다"로 쓸 수 있는 것들:

| 개선 | 대상 | 이력서 활용 | 우선순위 |
|------|------|-----------|---------|
| 결제 멱등성 키 도입 | cmong-be payments | "결제 중복 처리 방지를 위해 멱등성 키 패턴을 도입하여 웹훅 중복 처리율 0%로 개선" | 높음 |
| 대시보드 쿼리 튜닝 | cmong-be dashboard | "EXPLAIN 분석 기반으로 복합 인덱스 재설계, 쿼리 응답시간 Xms → Xms로 Y% 개선" | 높음 |
| 커넥션 풀 튜닝 | cmong-be TypeORM | "DB 커넥션 풀 사이즈를 부하 테스트 기반으로 최적화, 피크 시간 응답시간 X% 개선" | 중간 |
| 에러 분류 체계 고도화 | cmong-mq | "4단계 에러 분류 체계 설계로 자동 복구율 X% → Y%로 개선" | 중간 |
| 서킷 브레이커 설정 근거 | 분산 수집 시스템 | "에러율 임계값(50%/30%/15%)과 슬로우콜 기준(120초)을 실측 데이터 기반으로 최적화" | 낮음 |

---

## 8. 타임라인 요약

```
[1주차]      Phase 0: 문서 정리 + Spring 스켈레톤
[2~4주차]    Phase 1: 핵심 구현 + DB/Spring 공부
[5~10주차]   Phase 2: 차별화 (k6, JVM, 오픈소스, Coroutine)
[11~14주차]  Phase 3: 면접 준비 + 이력서 완성
[15주차~]    Phase 4: 지원 시작 (무신사/여기어때 → 토스/우아한 → 라인/네이버)
```

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-04-06 | V2 작성. 10개사 JD 분석 반영. 5년차 시니어 타겟으로 깊이 확장. Phase 0~4 실행 계획 추가 |
| 2026-04-13 | 2-2, 2-3 섹션 대폭 확장. 10개사 기술블로그 실제 아티클 기반 엔지니어링 깊이 분석 추가. 회사별 대표 글/수치/면접 타깃 깊이 명시. 전체 비교 매트릭스 추가 |
