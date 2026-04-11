# ADR-004: 분산 락 구현 — Redisson vs SET NX + Lua

- **상태**: 확정
- **날짜**: 2026-04-11
- **결정자**: 본인
- **연결 에피소드**: Episode #2 (다중 인스턴스 크론잡 중복 실행 방지)

---

## 배경과 문제

### 실무에서 겪은 문제

다중 인스턴스(10+) 환경에서 Shop별 크론잡이 동시에 실행되는 문제.
동일 Shop에 대한 크롤링/집계 배치가 두 인스턴스에서 동시 실행되면:
- 중복 데이터 집계 (결과 2배 증가)
- 외부 API에 과도한 요청 → Rate Limit 초과
- 데이터 경쟁 조건 (같은 Shop 상태를 두 트랜잭션이 동시 수정)

### 해결 방향

분산 환경에서 "특정 시점에 하나의 인스턴스만 실행"을 보장하는 분산 락 필요.

### 요구사항

| 요건 | 상세 |
|------|------|
| 상호 배제 | 같은 Shop에 대해 동시에 락 획득 불가 |
| 자동 만료 | 인스턴스 크래시 시 락이 무한 점유되지 않아야 함 |
| Watchdog | 정상 실행 중인 인스턴스의 락이 중간에 만료되면 안 됨 |
| 테스트 용이성 | 동시성 테스트가 가능해야 함 |

---

## 검토한 옵션

### Option A: DB 레벨 SELECT FOR UPDATE

```sql
-- 크론잡 실행 전
SELECT * FROM crawl_locks WHERE shop_id = ? FOR UPDATE;
INSERT INTO crawl_locks (shop_id, locked_at) VALUES (?, NOW());

-- 실행 후
DELETE FROM crawl_locks WHERE shop_id = ?;
```

**장점**
- 별도 인프라 불필요 (DB 활용)
- 트랜잭션과 자연스럽게 결합 (같은 트랜잭션 내에서 락 획득 + 작업)

**단점**
- 크론잡 실행 시간 = 트랜잭션 유지 시간 → Long Transaction 위험
- DB 커넥션 점유 (배치 작업이 길면 커넥션 풀 고갈)
- 분산 환경에서 DB가 SPOF가 될 수 있음

**결론**: 짧은 트랜잭션에는 적합하지만, 수 초~수 분 걸리는 크론잡에는 부적합.

---

### Option B: Redis SET NX + Lua Script (직접 구현)

```redis
-- 락 획득 (원자적)
SET lock:crawl:{shopId} {instanceId} NX PX {ttlMs}

-- 락 해제 (소유자만, Lua로 원자적 보장)
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
```

**장점**
- 저수준 제어 (TTL, 락 값 커스터마이징)
- Redis 네이티브 명령어 → 오버헤드 최소화
- 테스트에서 Redis 직접 검증 가능

**단점**
- 자동 TTL 갱신(Watchdog) 직접 구현 필요
- Lua script 유지보수 필요
- 네트워크 파티션 시 락 안전성 직접 검증해야 함

**Watchdog 직접 구현의 복잡도**:
```java
// 별도 스케줄러 스레드로 TTL 갱신
ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor();
watchdog.scheduleAtFixedRate(
    () -> redis.expire("lock:crawl:" + shopId, ttlSeconds),
    ttlSeconds / 3,  // TTL의 1/3마다 갱신
    ttlSeconds / 3,
    TimeUnit.SECONDS
);
// 작업 완료 또는 실패 시 watchdog 반드시 취소
// 이 취소 로직을 빠뜨리면 메모리 누수 발생
```

**결론**: 구현 가능하지만, Watchdog 관리 코드가 늘어나고 버그 가능성 증가.

---

### Option C: Redisson RLock (선택) ✅

```java
RLock lock = redissonClient.getLock("lock:crawl:" + shopId);
boolean acquired = lock.tryLock(0, TimeUnit.SECONDS); // waitTime=0: 즉시 실패

if (!acquired) {
    log.info("이미 실행 중인 크론잡, 스킵: shopId={}", shopId);
    return;
}

try {
    crawlShop(shopId);
} finally {
    if (lock.isHeldByCurrentThread()) {
        lock.unlock();
    }
}
```

**장점**
- Watchdog 내장: 락 보유 중 30초마다 자동 TTL 갱신
- JVM 크래시 시 Watchdog 중단 → 30초 후 자동 만료 (좀비 락 방지)
- FairLock, MultiLock 등 고급 패턴 기본 제공
- Spring Testcontainers로 실제 Redis 연결 테스트 용이

**단점**
- Redisson 라이브러리 의존성 추가
- SET NX 대비 명령어 수 증가 (내부적으로 Lua + Pub/Sub 사용)
- Redis Cluster 환경에서 RedLock 알고리즘 필요 (단일 노드 Redis 위험)

**결론**: 검증된 Watchdog 구현과 좀비 락 방지 자동화 → 운영 안전성 우선.

---

## 결정: Option C — Redisson RLock

### 선택 근거

1. **Watchdog 자동화**: 크론잡이 오래 걸려도 락 만료 걱정 없음
2. **좀비 락 방지**: JVM 크래시 → Watchdog 중단 → TTL 자동 만료 (약 30초)
3. **검증된 구현**: 수천 개 프로덕션 환경에서 검증된 라이브러리
4. **테스트 용이성**: Testcontainers + RedissonClient로 통합 테스트 자연스러움

### 운영 규칙

```java
// 1. 항상 tryLock (waitTime=0) — 크론잡은 이번 실행 포기, 다음 주기에 재시도
boolean acquired = lock.tryLock(0, TimeUnit.SECONDS);

// 2. finally에서 반드시 해제 + isHeldByCurrentThread 체크
finally {
    if (lock.isHeldByCurrentThread()) {  // 만료됐을 수도 있으므로
        lock.unlock();
    }
}

// 3. leaseTime을 명시하지 않으면 Watchdog 활성화
// leaseTime을 명시하면 Watchdog 비활성화 (TTL 고정)
lock.tryLock(0, -1, TimeUnit.SECONDS);  // leaseTime=-1 = Watchdog 활성화

// 4. 락 키 네이밍 규칙
// "lock:{도메인}:{식별자}"
// 예: lock:crawl:100, lock:batch:daily-aggregate
```

### 이 결정이 틀렸다고 판단할 기준

- Redisson Watchdog이 Redis 네트워크 파티션 시 오작동하는 경우
  → RedLock 알고리즘 검토 (다수결 방식, Redis 노드 3개 이상 필요)
- 락 경합이 높아 Redisson Pub/Sub 오버헤드가 문제가 되는 경우
  → 폴링 기반 스핀 락 또는 DB 레벨 분산 락으로 전환

---

## AI 검토 내용 (ADR-004)

**내가 물어본 것:**
> "Redisson Watchdog이 JVM 크래시 시 어떻게 동작하는지 설명해줘.
> 특히 TTL이 30초인데 실제로 30초 후에 자동 만료가 보장되는가?"

**AI 답변 요약:**
```
Watchdog 동작:
- 락 획득 시 내부 스케줄러(Netty EventLoop)에서 TTL/3마다 갱신 명령 전송
- JVM 크래시 → EventLoop 종료 → 갱신 명령 전송 안 됨
- Redis TTL = 30초 → 30초 후 자동 만료
- 단, GC Stop-the-World가 30초 이상 지속되면 락 만료 가능 (극단적 케이스)
```

**내 판단:**
- GC 30초 STW는 실용적으로 발생하지 않는 수준 (G1GC 기본 목표: 200ms)
- Redis 연결 끊김 시 Watchdog 갱신 실패 → 안전 측으로 만료 → 적절한 동작
- "안전 측으로 만료"가 올바른 동작 (락이 과도하게 유지되는 것보다 조기 해제가 낫다)

---

## 면접 연결

**Q. "Redisson 쓰면 Redis 의존성이 추가되는데, Redis가 다운되면 크론잡 전체가 실패하지 않나요?"**

```
"맞습니다. Redis가 다운되면 락 획득이 불가능합니다.
이 경우 두 가지 전략을 검토했습니다:

1. Fail-safe (선택): Redis 다운 시 락 획득 실패로 처리 → 크론잡 스킵
   - Redis 장애 = 일시적 데이터 수집 중단 (허용 가능)
   - 중복 실행이 데이터 정합성에 더 큰 위험

2. Fail-open: Redis 다운 시 락 없이 실행 허용
   - 데이터 중복 집계 위험
   - 우리 시스템에서는 적합하지 않음

Redis를 분산 락 전용으로 쓰는 것이 아니라 캐시도 함께 사용하므로,
Redis 고가용성(Redis Sentinel or Cluster)은 어차피 필수입니다."
```
