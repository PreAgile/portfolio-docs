# ADR-003: 캐시 전략 - Cache-Aside + Stampede 방지

- **날짜**: 2026-04-03
- **상태**: 결정됨
- **결정자**: 본인
- **적용 범위**: platform-api

---

## 배경 및 문제 정의

platform-api에서 가게 정보(Shop) 조회가 전체 요청의 70% 이상을 차지한다고 가정한다. (실제 운영에서 크롤링 대상 가게 정보는 자주 바뀌지 않음 - 캐시 적합)

DB에 직접 조회하면:
- P99 응답 시간이 요청 증가에 따라 선형 증가
- 동시 트래픽 급증 시 DB 커넥션 풀 고갈

캐시를 도입하면 새로운 문제가 생긴다:
1. **Cache Stampede**: 캐시 만료 시 대량의 요청이 동시에 DB로 몰림
2. **캐시 정합성**: DB 업데이트 후 캐시가 오래된 값을 반환
3. **캐시 계층**: 로컬 캐시와 분산 캐시 중 무엇을 쓸 것인가

---

## 검토한 대안

### Option A: Spring Cache + Redis (단순 Cache-Aside)
```kotlin
@Cacheable(cacheNames = ["shop"], key = "#id")
fun findShop(id: Long): Shop = shopRepository.findById(id)
```

**장점**: 구현 단순, 어노테이션 한 줄

**단점**:
- Cache Stampede 방지 없음 → 캐시 만료 시 DB 폭격
- 분산 환경에서 여러 인스턴스가 동시에 DB 조회 시작
- TTL 만료와 @CacheEvict 타이밍 불일치 가능

### Option B: Caffeine (로컬 캐시) + Redis (분산 캐시) 2계층
카카오페이 기술블로그에서 실제 사용하는 패턴.

```
요청 → Caffeine(로컬, 30초 TTL) → Redis(분산, 10분 TTL) → DB
```

**장점**:
- 네트워크 I/O 없는 로컬 캐시 히트 → 응답 시간 극소화
- Redis 장애 시 로컬 캐시로 Fallback 가능

**단점**:
- 다중 인스턴스에서 로컬 캐시 일관성 문제 (인스턴스마다 다른 값)
- 캐시 무효화 시 모든 인스턴스의 로컬 캐시를 동기화해야 함 (Redis Pub/Sub 필요)
- 구현 복잡도 상승

### Option C: Cache-Aside + Redis 분산락 (Stampede 방지) (선택)

```kotlin
suspend fun findShop(id: Long): Shop {
    // 1차: Redis 조회
    redisTemplate.get("shop:$id")?.let { return it }
    
    // 2차: 분산락으로 단 하나의 요청만 DB 조회
    val lock = redissonClient.getLock("lock:shop:$id")
    return withContext(Dispatchers.IO) {
        lock.tryLock(5, 10, TimeUnit.SECONDS)
        try {
            // Double-Check: 락 획득 후 다시 Redis 확인
            redisTemplate.get("shop:$id")?.let { return@withContext it }
            
            shopRepository.findById(id)
                ?.also { shop -> redisTemplate.set("shop:$id", shop, Duration.ofMinutes(10)) }
                ?: throw ShopNotFoundException(id)
        } finally {
            if (lock.isHeldByCurrentThread) lock.unlock()
        }
    }
}
```

**장점**:
- Cache Stampede 근본적 방지 (락 획득한 요청 하나만 DB 조회)
- Double-Check로 락 획득 후에도 캐시 재확인 → 불필요한 DB 조회 방지
- Redis 하나로 캐시 + 락 통합

**단점**:
- 락 획득 실패 시 타임아웃(5초) 동안 대기
- Redis 장애 시 캐시 + 락 동시 불가
- 구현이 단순 Cache-Aside보다 복잡

---

## AI와 함께 검토한 내용

**내가 AI에게 물어본 것**:
> "Cache Stampede는 실제로 얼마나 자주 발생하나요? 과도한 설계 아닌가요?"

**AI 답변 요약**:
> "Stampede는 트래픽이 낮을 때는 거의 발생 안 합니다. 하지만 트래픽 급증 + 캐시 만료가 동시에 일어나는 '최악의 타이밍'에 발생하고, 그 순간 DB가 다운될 수 있습니다. 포트폴리오 관점에서는 'Stampede가 뭔지 알고 방어했다'는 것 자체가 어필 포인트입니다. 단, 락 구현은 분산락 라이브러리(Redisson)를 쓰세요. 직접 구현하면 엣지 케이스가 많습니다."

**내 판단**:
실제 운영에서 특정 크롤링 작업 완료 후 캐시가 한꺼번에 만료되는 상황(배치성 업데이트)에서 Stampede가 실제로 발생했을 가능성이 높다. 이 경험을 근거로 방어 설계를 선택한다. 2계층 캐시(Option B)는 구현 복잡도 대비 로컬 캐시 일관성 문제가 현재 단계에서는 오버엔지니어링.

---

## 결정: Cache-Aside + Redis 분산락 (Stampede 방지)

### 선택 근거
1. **Stampede 방어**: 실제 운영에서 배치성 캐시 만료 타이밍에 DB 부하 급증 경험 → 근본 원인 해결
2. **단순한 운영**: 2계층 대비 운영 포인트가 Redis 하나
3. **Double-Check 패턴**: 면접에서 "왜 락 획득 후에 다시 캐시를 확인하나요?"라는 질문에 답할 수 있음

### 캐시 무효화 전략
```
쓰기 작업 시: DB 업데이트 → 즉시 Redis 삭제 (TTL 만료 기다리지 않음)
이유: 오래된 값이 최대 TTL(10분)만큼 유지되는 것보다 즉시 무효화가 정합성 측면에서 안전
```

### 이 결정이 틀렸다고 판단할 기준
- 인스턴스가 5개 이상으로 늘어나고 Redis 네트워크 레이턴시가 병목이 되는 시점 → 2계층 캐시 재검토
- Redis 장애 빈도가 높아지는 경우 → 로컬 캐시 Fallback 추가

---

## 구현 결정 사항

| 설정 | 값 | 근거 |
|-----|---|-----|
| Redis TTL | 10분 | 가게 정보는 자주 바뀌지 않음, 만료 시 DB 조회 비용 감수 |
| 락 대기 시간 | 5초 | 5초 이상 대기는 사용자 경험 저하, 타임아웃 후 예외 반환 |
| 락 보유 시간 | 10초 | DB 조회 + Redis 저장 시간 여유분 포함 |
| Double-Check | 필수 | 락 획득 후 다른 인스턴스가 이미 캐싱한 경우 DB 조회 불필요 |

---

## 참고
- [카카오페이 - 분산 시스템에서 로컬 캐시 활용하기](https://tech.kakaopay.com/post/local-caching-in-distributed-systems/)
- [Redisson 공식 문서 - Distributed Lock](https://redisson.org/glossary/java-distributed-lock.html)
- [Cache Stampede 해결 방법 - 우아한형제들 기술블로그](https://techblog.woowahan.com/2665/)
