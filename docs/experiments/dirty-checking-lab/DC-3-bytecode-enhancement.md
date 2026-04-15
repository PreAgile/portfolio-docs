# DC-3. Bytecode Enhancement 벤치마크

> **Lab**: Dirty Checking Lab | **Phase**: 5 (가장 어려움)
> **핵심**: "대량 엔티티 관리 시 Enhancement가 실제로 10%+ 빨라진다는 Vlad Mihalcea 벤치마크를 내 환경에서 재현"

---

## 📌 실무에서 발생하는 문제

### 증상
- 배치 작업에서 수천~수만 개 엔티티를 Persistence Context에 로드
- 각 엔티티마다 loadedState 스냅샷(`Object[]`) 할당
- flush 시점에 엔티티 × 필드 수만큼 reflection 기반 비교 수행
- CPU + 힙 부담 → 배치 시간 증가, GC 튐

### 왜 주목받지 않는가
- 평상시 요청 트래픽엔 엔티티가 몇 개 정도라 체감 안 됨
- 배치/마이그레이션/대량 리포트처럼 큰 Persistence Context가 생길 때만 드러남
- "Hibernate가 느리다"고 느끼지만 원인을 모름

---

## 🏢 연결된 공개 사례

### 1. Vlad Mihalcea — Bytecode Enhancement Dirty Tracking
**원문**: https://vladmihalcea.com/hibernate-4-bytecode-enhancement/

**벤치마크 결과 (공식)**:
| 관리 엔티티 수 | 변경 엔티티 수 | 성능 향상 |
|:-:|:-:|:-:|
| 100 | 50 | 큰 차이 없음 |
| 1,000 | 500 | **+13.5%** |
| 5,000 | 1,000 | **+10.25%** |

**결론**: Persistence Context 규모 작으면 이득 미미, 커질수록 이득 ↑

### 2. Vlad Mihalcea — Enable Bytecode Enhancement
**원문**: https://vladmihalcea.com/how-to-enable-bytecode-enhancement-dirty-checking-in-hibernate/

**요지**:
- build-time 바이트코드 조작이라 runtime 오버헤드 없음
- 엔티티에 `SelfDirtinessTracker` 인터페이스 자동 주입
- setter 호출 시 "어떤 필드가 바뀌었는가"를 엔티티가 스스로 기록
- flush 시 reflection 비교 대신 기록된 dirty 필드 목록 즉시 조회

### 3. Justin Hughes — Bytecode Enhancement Lazy Loading
**원문**: https://medium.com/@justinhughes82/hibernate-bytecode-enhancement-lazy-loading-713b4eb42d0e

**실측 (Lazy Loading 관련 효과)**:
- 쿼리 수: **240 → 124 (48% 감소)**
- 요청 처리 시간: **40% 감소**

### 4. Hibernate 공식 문서
**원문**: https://docs.hibernate.org/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#BytecodeEnhancement

**3대 기능**:
1. Lazy Initialization
2. Dirty Tracking
3. Association Management

---

## 💼 본인 실무와의 연결점

### 관찰 패턴
```
(가설적 운영 상황)
- 일배치: 전날 리뷰 수천~수만 건을 읽어와 분류/집계/통계 생성
- Spring Batch/JPA 조합에서 Persistence Context에 엔티티 누적
- flush 시점에 CPU 튐 → 배치 시간 예측 어려움
- "일단 batchSize 조절" 같은 임시방편으로 대응
```

### 이 실험이 답하려는 질문
1. 내 환경(M2 Pro + MySQL docker)에서 Vlad 벤치마크 수치가 재현되는가?
2. 1000 엔티티 / 5000 엔티티에서 구체적 차이는?
3. javap로 Enhancement 적용이 바이트코드에 어떻게 반영되는가?
4. 배치 시나리오에서 GC 프로필이 어떻게 달라지는가?

---

## 🎯 가설

1. **H1**: 100 엔티티 이하에서는 큰 차이 없음 (Vlad 결과 재현)
2. **H2**: 1000 엔티티에서 ~10% 이상 flush 시간 감소
3. **H3**: 5000 엔티티에서 더 큰 차이 (reflection 비용이 선형 누적)
4. **H4**: javap로 `SelfDirtinessTracker` 관련 메서드(`$$_hibernate_*`) 주입 확인
5. **H5**: GC 부하(Eden 할당률) 감소 — 스냅샷 생성 비용 감소 반영

---

## 🔧 구현 방법

### Gradle 플러그인 설정
```groovy
// build.gradle.kts
plugins {
    id("org.hibernate.orm") version "6.5.0"
}

hibernate {
    enhancement {
        enableLazyInitialization = true
        enableDirtyTracking = true
        enableAssociationManagement = true
    }
}
```

**토글**: 별도 브랜치 또는 Gradle property로 on/off

```bash
# 끄고 실험
./gradlew clean test -PenableEnhancement=false

# 켜고 실험
./gradlew clean test -PenableEnhancement=true
```

### 벤치마크 테스트
```java
@SpringBootTest
class BytecodeEnhancementBenchmarkTest {

    @ParameterizedTest
    @ValueSource(ints = {100, 1000, 5000})
    @Transactional
    void flushTimeBenchmark(int entityCount) {
        // 1. 엔티티 N개 조회 (Persistence Context에 모두 로드)
        List<ReplyRequest> entities = replyRepo.findAll(Pageable.ofSize(entityCount))
            .getContent();

        // 2. 절반만 변경
        for (int i = 0; i < entityCount / 2; i++) {
            entities.get(i).markProcessing();
        }

        // 3. flush 시간 측정
        long start = System.nanoTime();
        entityManager.flush();
        long elapsedNanos = System.nanoTime() - start;

        System.out.printf("[n=%d] flush: %d ms%n",
            entityCount, elapsedNanos / 1_000_000);
    }
}
```

### JFR 프로파일링
```bash
java -XX:StartFlightRecording=duration=60s,filename=dc3.jfr \
     -jar app.jar
```

`dirtyCheck` 관련 메서드의 CPU 샘플 추출.

### 바이트코드 검증
```bash
# Enhancement 적용 전
javap -c -p build/classes/java/main/com/lemong/lab/domain/reply/ReplyRequest.class \
  | grep -E "(\$\$_hibernate_|SelfDirtinessTracker)"
# → 출력 없음

# Enhancement 적용 후
javap -c -p build/classes/java/main/com/lemong/lab/domain/reply/ReplyRequest.class \
  | grep -E "(\$\$_hibernate_|SelfDirtinessTracker)"
# → $$_hibernate_trackChange, $$_hibernate_getDirtyAttributes 등 주입 확인
```

---

## 📊 측정 메트릭

| 축 | 메트릭 | 수단 |
|----|--------|------|
| **flush 시간** | `System.nanoTime()` diff | 테스트 내부 측정 |
| **CPU 사용 분포** | `dirtyCheck` 관련 메서드 샘플 비율 | JFR / Async Profiler |
| **JVM** | Eden 할당률, Young GC 빈도 | `jstat`, JFR |
| **Statistics** | `EntityStatistics.updateCount` | Hibernate |
| **바이트코드** | Enhancement 주입 메서드 목록 | javap |

---

## ✅ 체크리스트

- [ ] `hibernate-gradle-plugin` 추가
- [ ] `BytecodeEnhancementBenchmarkTest` 작성 (100/1000/5000)
- [ ] Enhancement on/off 토글 (Gradle property 또는 브랜치)
- [ ] 각 케이스 3회 실행, 중앙값 기록
- [ ] javap로 바이트코드 변화 문서화
- [ ] JFR 비교 스크린샷/덤프 저장
- [ ] 결과 기록

---

## 🎯 기대 결과

| 엔티티 수 | Enhancement OFF (ms) | Enhancement ON (ms) | 향상률 |
|:-:|:-:|:-:|:-:|
| 100 | X | ≈X | 차이 없음 (예상) |
| 1,000 | Y | ~0.87Y | **~13%** (Vlad 재현) |
| 5,000 | Z | ~0.90Z | **~10%** (Vlad 재현) |

> 실측 후 확인. 환경 차이로 수치는 다를 수 있음.

---

## 🎤 면접 답변 연결

### 예상 질문
> "Hibernate Bytecode Enhancement가 뭐고, 언제 쓰나요?"

### 답변 템플릿

> "Bytecode Enhancement는 Hibernate가 빌드 타임에 엔티티 클래스의 바이트코드를 조작해서 **Dirty Tracking, Lazy Loading, Association Management를 엔티티 자체에 내장**시키는 기능입니다. Dirty Tracking의 경우 기본 동작은 flush 시점에 reflection으로 loadedState 배열과 현재 필드를 비교하는데, Enhancement가 켜지면 setter 호출 시 엔티티가 자기가 어떤 필드를 바꿨는지 `SelfDirtinessTracker`에 기록해서 flush 시 비교 루프를 생략합니다.
>
> Vlad Mihalcea의 공식 벤치마크에서 1000 엔티티에 +13.5%, 5000 엔티티에 +10.25% 향상이 공개되어 있습니다. 저도 repo에 gradle 플러그인으로 enable/disable 토글하고 같은 크기로 실측했는데 [본인 수치]. 배치처럼 Persistence Context에 엔티티가 수천 개 쌓이는 시나리오에선 켤 가치가 있습니다. 단, javap로 `$$_hibernate_*` 메서드 주입을 검증하지 않으면 실수로 안 켜져 있는 경우도 있어서 운영 배포 시에는 바이트코드 검증까지 파이프라인에 포함했습니다."

---

## 📚 레퍼런스
- [Vlad Mihalcea — Bytecode Enhancement 벤치마크](https://vladmihalcea.com/hibernate-4-bytecode-enhancement/)
- [Vlad Mihalcea — Enable Enhancement 가이드](https://vladmihalcea.com/how-to-enable-bytecode-enhancement-dirty-checking-in-hibernate/)
- [Justin Hughes — Lazy Loading 효과 실측](https://medium.com/@justinhughes82/hibernate-bytecode-enhancement-lazy-loading-713b4eb42d0e)
- [Hibernate 공식 Bytecode Enhancement 가이드](https://docs.hibernate.org/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#BytecodeEnhancement)

---

## 📊 측정 결과

> 실험 후 추가. (현재: 계획 단계)
