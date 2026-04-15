# DC-2. `@DynamicUpdate` 트레이드오프 측정

> **Lab**: Dirty Checking Lab | **Phase**: 4 (중간 난이도)
> **핵심**: "변경된 필드만 UPDATE가 항상 빠른가? Statement cache miss 비용을 감안해도?"

---

## 📌 실무에서 발생하는 문제

### 증상
- 엔티티에 필드가 수십 개 (예: 사용자 프로필, 주문, 정산 레코드)
- 실제 변경되는 건 1~2개 필드인데, Hibernate가 **전체 컬럼**을 UPDATE에 포함
- 대용량 테이블에서 불필요한 네트워크 트래픽 + 인덱스 재계산

### 전형적인 상황
```sql
-- 필드 20개 엔티티의 1개 필드(retry_count)만 바꿨을 때
UPDATE reply_requests
   SET id=?, review_id=?, platform=?, reply_content=?, request_status=?,
       retry_count=?, last_attempted_at=?, created_at=?, updated_at=?, ...
 WHERE id=?
-- 바이트 페이로드 커짐, 필드 많은 인덱스/트리거 영향
```

### 왜 기본값이 "전체 컬럼 포함"인가
- 기본값이면 **SQL이 고정 형태**라 prepared statement를 재사용 가능
- 드라이버/DB 양쪽에서 statement 캐시 효율 높음
- 대신 payload가 커지고 변경 안 된 필드의 인덱스 재계산 비용 발생

---

## 🏢 연결된 공개 사례

### 1. Thorben Janssen — Dynamic Inserts and Updates
**원문**: https://thorben-janssen.com/dynamic-inserts-and-updates-with-spring-data-jpa/

**핵심 지적**:
- 큰 엔티티에서 1~2 필드만 변경되는 시나리오에 효과적
- 하지만 **statement cache 재사용성 저하**로 고부하 환경에선 역효과 가능
- `@LastModifiedDate`처럼 항상 바뀌는 감사 필드가 있으면 효과 감소

### 2. Baeldung — @DynamicUpdate with Spring Data JPA
**원문**: https://www.baeldung.com/spring-data-jpa-dynamicupdate

**요약**:
- 프로토타입 수준 예제로 차이 보여줌
- 트레이드오프: "payload 감소 vs dirty checking 추가 오버헤드"

### 3. Hibernate 공식 Javadoc
**원문**: https://docs.hibernate.org/orm/6.5/javadocs/org/hibernate/annotations/DynamicUpdate.html

**공식 권장**:
- "a few columns only"일 때 적용 권고
- 감사 필드 많으면 효과 제한

### 4. Vlad Mihalcea — 성능 튜닝 팁
**원문**: https://vladmihalcea.com/hibernate-performance-tuning-tips/

**관통하는 메시지**:
> "`@DynamicUpdate`는 '공짜 최적화'가 아니다. 반드시 실측으로 이득 확인 후 적용해야 한다."

---

## 💼 본인 실무와의 연결점

### 관찰 패턴

```
(가설적 운영 상황)
- reply_requests 테이블: id, review_id, platform, reply_content, request_status,
  retry_count, last_attempted_at, created_at, updated_at, failure_reason,
  external_reply_id, scraper_instance, ... (15~20개 필드)
- 상태 업데이트 시 대부분 request_status + retry_count + updated_at만 바뀜
- 하지만 Hibernate는 20개 컬럼 전부 UPDATE에 포함
```

### 영향
1. **네트워크 payload**: 컬럼 수만큼 바인딩 파라미터 송수신
2. **MySQL binlog**: row-based replication 시 전체 before/after 이미지 기록
3. **인덱스 재계산**: 바뀌지 않은 컬럼이 복합 인덱스에 포함돼 있으면 재계산
4. **트리거**: 변경 감지 트리거가 있으면 불필요하게 발동

### 이 실험이 답하려는 질문
1. `@DynamicUpdate` 적용 시 실제 payload/TPS 차이는?
2. Statement cache miss 비용은 **수치로** 얼마나 되는가?
3. 쓰기 트래픽 수준에 따라 임계점이 있는가?

---

## 🎯 가설

1. **H1 (payload)**: `@DynamicUpdate` 시 UPDATE SQL 평균 길이가 대폭 감소
2. **H2 (TPS 저부하)**: 저부하에선 payload 이득 > cache miss 비용 → 소폭 향상
3. **H3 (TPS 고부하)**: 고부하에선 cache miss 비용 증가로 TPS 오히려 정체/감소 가능
4. **H4 (MySQL binlog)**: binlog 크기 감소 (row format 기준)

---

## 🔧 구현 방법

### 엔티티 설계 — 필드 많은 대조 엔티티

```java
@Entity
@Table(name = "user_profiles_plain")
public class UserProfilePlain {   // 대조군
    @Id Long id;
    String field01; String field02; String field03; String field04; String field05;
    String field06; String field07; String field08; String field09; String field10;
    String field11; String field12; String field13; String field14; String field15;
    String field16; String field17; String field18; String field19; String field20;
    // @DynamicUpdate 없음
}

@Entity
@Table(name = "user_profiles_dynamic")
@DynamicUpdate
public class UserProfileDynamic {   // 실험군
    @Id Long id;
    String field01; String field02; ... String field20;
}
```

### 서비스
```java
@Service
public class DC2Service {
    @Transactional
    public void updateOneFieldPlain(Long id, String value) {
        UserProfilePlain p = plainRepo.findById(id).orElseThrow();
        p.setField01(value);  // 1개만 변경
    }

    @Transactional
    public void updateOneFieldDynamic(Long id, String value) {
        UserProfileDynamic p = dynamicRepo.findById(id).orElseThrow();
        p.setField01(value);
    }
}
```

### k6 시나리오 (2단계: 저부하 → 고부하)
```javascript
export const options = {
  scenarios: {
    low_plain: { vus: 20, duration: '1m', exec: 'updatePlain' },
    low_dynamic: { vus: 20, duration: '1m', startTime: '1m30s', exec: 'updateDynamic' },
    high_plain: { vus: 200, duration: '1m', startTime: '3m', exec: 'updatePlain' },
    high_dynamic: { vus: 200, duration: '1m', startTime: '4m30s', exec: 'updateDynamic' },
  },
};
```

---

## 📊 측정 메트릭

| 축 | 메트릭 | 수단 |
|----|--------|------|
| **SQL 크기** | UPDATE 평균 바이트 | p6spy 로그 파싱 |
| **DB 부하** | MySQL `Bytes_sent`, `Bytes_received` | `SHOW STATUS` |
| **Statement cache** | MySQL `Prepared_stmt_count`, `Com_stmt_prepare/execute` | `SHOW STATUS` |
| **TPS/p99** | 표준 | Grafana |
| **Binlog 크기** | `mysqlbinlog` 파일 크기 비교 | CLI |

---

## ✅ 체크리스트

- [ ] `UserProfilePlain` / `UserProfileDynamic` 엔티티 추가
- [ ] data.sql에 seed (양쪽 각 1000건)
- [ ] DC2 API `/api/dc2/plain/{id}`, `/api/dc2/dynamic/{id}` 추가
- [ ] p6spy SQL 로그에서 UPDATE 길이 수집 스크립트
- [ ] MySQL binlog 크기 측정 절차 문서화
- [ ] k6 2단계 시나리오 (저부하/고부하)
- [ ] 결과 기록 + 이 문서 "측정 결과" 섹션 채우기

---

## 🎯 기대 결과 시나리오

| 시나리오 | plain | dynamic | 해석 |
|----------|-------|---------|------|
| **저부하 (20 VU)** | TPS = X | TPS ≈ X+α | payload 감소 효과 |
| **고부하 (200 VU)** | TPS = Y | TPS ≈ Y 또는 Y-α | cache miss 영향 드러남 |
| **UPDATE 평균 길이** | 500B | 80B | 예상 |
| **Binlog 크기** | 100MB | 30MB | payload 감소 반영 |

> 실험 후 실측으로 업데이트.

---

## 🎤 면접 답변 연결

### 예상 질문
> "`@DynamicUpdate`는 언제 쓰시겠어요?"

### 답변 템플릿

> "`@DynamicUpdate`는 '컬럼이 많고 변경 필드가 적은' 경우에 payload 감소 이득이 있습니다. 하지만 **statement cache 재사용성이 떨어진다**는 대가가 있어서, 쓰기 트래픽이 높으면 오히려 TPS가 정체될 수 있습니다.
>
> 제가 repo에서 필드 20개 엔티티로 1개 필드만 변경하는 시나리오를 k6 저부하/고부하 2단계로 측정했는데, 저부하에서는 [수치], 고부하에서는 [수치]였습니다. 결론은 '실측 없이 기본값에서 바꾸지 말라'이고, 적용한다면 binlog 크기 이득까지 함께 보는 게 맞습니다."

---

## 📚 레퍼런스
- [Thorben Janssen — Dynamic Inserts/Updates](https://thorben-janssen.com/dynamic-inserts-and-updates-with-spring-data-jpa/)
- [Baeldung — @DynamicUpdate](https://www.baeldung.com/spring-data-jpa-dynamicupdate)
- [Hibernate Javadoc — @DynamicUpdate](https://docs.hibernate.org/orm/6.5/javadocs/org/hibernate/annotations/DynamicUpdate.html)
- [Vlad Mihalcea — Performance Tips](https://vladmihalcea.com/hibernate-performance-tuning-tips/)

---

## 📊 측정 결과

> 실험 후 추가. (현재: 계획 단계)
