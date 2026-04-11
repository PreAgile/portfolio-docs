# 성능 측정 결과

> **목적**: k6 부하테스트와 프로파일링을 통해 실측된 수치를 기록한다.
> "예상치"와 "실측치"를 명확히 구분하여 신뢰도를 높인다.
>
> **원칙**: 측정하지 않은 수치는 기재하지 않는다. 예상치는 "예상: X" 형식으로만 기재.
>
> **작성일**: 2026-04-11

---

## 현재 상태

| 항목 | 상태 |
|------|------|
| platform-api 구현 | 🔜 Phase 0 (미완료) |
| k6 부하테스트 실행 | 🔜 Phase 1 완료 후 |
| Grafana 대시보드 스크린샷 | 🔜 Phase 2 |

**아직 실측값 없음. 구현 완료 후 이 파일에 기록 예정.**

---

## 외부 의존성 Stub 전략

> **이 포트폴리오는 사이드 프로젝트다.**
> 실제 PG사 API나 외부 플랫폼에 대량 요청을 보낼 수 없으므로,
> 외부 의존성은 모두 Stub으로 대체한다.

**측정 목적과 범위**

```
✅ 측정하는 것 (내 코드의 병목)
  - DB 커넥션 풀 경합 (HikariCP)
  - 스레드 경합 (크롤러 vs 결제 처리)
  - 트랜잭션 락 대기 (@Transactional 범위)
  - 캐시 효과 (Caffeine L1, Redis L2)
  - Kafka Consumer Lag

❌ 측정하지 않는 것 (외부 변수)
  - PG사 서버 응답 속도
  - 실제 외부 플랫폼 응답 속도
  - 실제 네트워크 레이턴시
```

**Stub 구현 방식**

```java
// @Profile("load-test") 로 부하테스트 환경에서만 활성화

// 1. 가짜 PG 엔드포인트
@RestController
@Profile("load-test")
@RequestMapping("/stub/pg")
class FakePgController {
    @PostMapping("/payments")
    ResponseEntity<?> process() {
        Thread.sleep(ThreadLocalRandom.current().nextLong(80, 200)); // 실제 PG 지연 시뮬레이션
        return ResponseEntity.ok(Map.of("pgTxId", UUID.randomUUID().toString(), "status", "APPROVED"));
    }
}

// 2. 가짜 외부 플랫폼 엔드포인트
@RestController
@Profile("load-test")
@RequestMapping("/stub/platform")
class FakePlatformController {
    @GetMapping("/shops/{shopId}/reviews")
    ResponseEntity<?> getReviews(@PathVariable Long shopId) {
        Thread.sleep(ThreadLocalRandom.current().nextLong(200, 800)); // 플랫폼별 응답 지연
        if (ThreadLocalRandom.current().nextInt(100) < 10) {
            return ResponseEntity.status(429).build(); // 10% Rate Limit
        }
        return ResponseEntity.ok(FakeReviewData.generate(shopId));
    }
}
```

**왜 Stub이어도 측정이 유효한가**

> 부하테스트의 목적은 PG나 외부 플랫폼의 성능이 아니라
> "크롤러 500 VU가 DB 커넥션 풀을 잡으면 결제 처리가 얼마나 영향받는가"다.
> DB 커넥션 풀 경합은 downstream이 실제든 Stub이든 동일하게 발생한다.

면접에서 이 부분을 물으면:
> "사이드 프로젝트라 실제 PG를 호출할 수 없어 Stub을 썼습니다.
> 측정 목적이 PG 성능이 아니라 내 서비스의 커넥션 풀 경합이었기 때문에
> Stub으로도 의미 있는 측정이 가능했습니다."

---

## 측정 시나리오 계획

### Scenario 1: Baseline (캐시 없음, Cold Start)

```javascript
// projects/infra/k6/load-test.js
export let options = {
  stages: [
    { duration: '2m', target: 50 },    // Warm-up
    { duration: '5m', target: 100 },   // Sustained load
    { duration: '2m', target: 0 },     // Cool-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_err_rate: ['<1%'],
  },
};
```

**목표 지표**:
- TPS: 예상 1,000~2,000
- P95: 예상 < 300ms
- P99: 예상 < 500ms
- 에러율: < 1%

**실측 결과**: 미측정 (Phase 1 완료 후 업데이트)

---

### Scenario 2: Warm (캐시 히트율 80%)

**캐시 히트율 80% 조건**:
- 사전 로드: 상위 Shop 1,000개 데이터를 Caffeine + Redis에 미리 적재
- 요청 분포: Zipf 분포 (상위 20% Shop에 80% 요청 집중)

**목표 지표**:
- TPS: 예상 8,000~10,000
- P95: 예상 < 20ms
- P99: 예상 < 50ms

**실측 결과**: 미측정

---

### Scenario 3: Cache Stampede 시뮬레이션

**시나리오**:
1. 상위 Shop 100개 캐시를 동시에 만료
2. 동시에 1,000개 요청 발생

**비교 측정**:
- WITHOUT 분산 락: DB 동시 접근 쿼리 수, TPS 저하율
- WITH 분산 락 (Redisson): 동일 조건에서 TPS 비교

**목표**:
- DB 쿼리 수: WITH 락 시 캐시 미스당 1회 (WITHOUT = 수십~수백 회)
- TPS 저하율: WITH 락 시 < 20% (WITHOUT = 예상 80%+ 저하)

**실측 결과**: 미측정

---

### Scenario 4: 분산 락 경합 측정 (Episode #2)

**시나리오**:
- 동일 ShopId로 100개 동시 크론잡 트리거
- 1개만 실행되고 99개는 즉시 실패하는지 검증

**측정 지표**:
- 실제 실행 횟수 (1회 기대)
- 락 획득 실패 횟수 (99회 기대)
- 락 획득 시간 (P99)

**실측 결과**: 미측정

---

### Scenario 5: Kafka Consumer Lag 측정

**시나리오**:
- 초당 1,000개 이벤트 발행
- Consumer 처리 시간 인위적으로 100ms로 설정
- Consumer Lag 변화 추이 관찰

**측정 지표**:
- Consumer Lag (records behind)
- Processing Time (P95, P99)
- Rebalance 발생 횟수

**실측 결과**: 미측정

---

## 측정 환경 (계획)

```yaml
# docker-compose.yml 기반 로컬 측정 환경
platform-api:
  resources:
    cpus: '2.0'
    memory: 2G
  JVM 옵션: -Xmx1g -XX:+UseG1GC -XX:MaxGCPauseMillis=100

mysql:
  resources:
    cpus: '2.0'
    memory: 2G

redis:
  resources:
    cpus: '0.5'
    memory: 512M

kafka:
  resources:
    cpus: '1.0'
    memory: 1G

k6:
  virtual users: 최대 500
  duration: 시나리오별 상이
```

**주의**: 로컬 환경은 프로덕션 대비 성능이 낮음.
실측 수치는 "로컬 환경 기준"임을 명시하고, 프로덕션 추정치 별도 계산.

---

## 수치 업데이트 이력

| 날짜 | 업데이트 내용 | 비고 |
|------|-------------|------|
| 2026-04-11 | 초기 문서 작성, 시나리오 계획 | 실측값 없음 |
| (예정) | Scenario 1, 2 실측 | platform-api Phase 0 완료 후 |
| (예정) | Scenario 3, 4 실측 | 분산 락 구현 완료 후 |
| (예정) | Scenario 5 실측 | platform-event-consumer 완료 후 |
| (예정) | Grafana 스크린샷 추가 | Phase 2 완료 후 |

---

## 면접 대비 — 수치 질문 대응

**Q. "8,500 TPS 수치는 어떻게 측정하셨나요?"**

현재 상태 (정직한 답변):
```
"아직 구현 완료 후 k6로 측정할 예정입니다.
현재 문서의 8,500 TPS는 캐시 히트율 80% + 로컬 환경 기준 예상치입니다.
실제 측정 후 이 수치가 달라질 수 있으며, 측정 결과는 [GitHub 링크]에 업데이트됩니다."
```

**중요**: 측정하지 않은 수치를 측정한 것처럼 말하지 않는다.
예상치라도 "어떻게 계산했는가"의 로직은 설명할 수 있어야 한다.

**예상치 계산 근거**:
```
캐시 미스 응답: DB 쿼리 + 캐시 저장 ≈ 50ms
캐시 히트 응답: L1(Caffeine) 히트 ≈ 1ms, L2(Redis) 히트 ≈ 5ms

히트율 80% 가정 시:
평균 응답 시간 = 0.2 × 50ms + 0.8 × 5ms = 10 + 4 = 14ms

TPS = (1000ms / 14ms) × 스레드 수(100) ≈ 7,100 TPS
→ 네트워크 오버헤드 등 감안 시 6,000~8,500 TPS 예상
```
