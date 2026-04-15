# 면접 Q&A 아카이브 (Repo × 실험별)

> **목적**: 각 실험을 진행하면서 "이 주제로 면접관이 파고들면 어떻게 답할 것인가?"를 미리 시뮬레이션.
> **원칙**: 단순 암기가 아니라, **개념 → 원리 → 트레이드오프 → CS 레벨 → 실무 경험**의 5단계로 깊이 진입.

---

## 폴더 구조

```
qna/
├── README.md                              ← 이 파일 (전체 인덱스)
├── TEMPLATE.md                            ← 새 Q&A 작성 시 기본 형식
│
├── concurrency-cache-lab/                 ← Repo 1: 동시성 & 캐시 랩
│   ├── track1-01-lost-update.md          ← 이슈 #4
│   ├── track1-02-synchronized.md         ← 이슈 #5 (예정)
│   ├── track1-03-pessimistic-lock.md     ← 이슈 #6 (예정)
│   ├── track1-04-redisson.md             ← 이슈 #7 (예정)
│   ├── track3-01-no-cache.md             ← 이슈 #9 (예정)
│   ├── track3-02-stampede.md             ← 이슈 #10 (예정)
│   └── track3-03-two-layer-cache.md      ← 이슈 #11 (예정)
│
├── platform-api/                          ← Repo 2: API 서버 (예정)
│   └── ...
│
└── platform-event-consumer/               ← Repo 3: 이벤트 컨슈머 (예정)
    └── ...
```

---

## 5단계 깊이 모델

각 Q&A는 이 다섯 층위로 구성합니다:

| 단계 | 무엇을 답하나 | 기대 수준 |
|:---:|---|---|
| **L1. 개념** | 용어 정의, 무엇이 일어나는지 | 주니어 — 기본 지식 확인 |
| **L2. 원리** | 왜 그렇게 되는지 내부 동작 | 3년차 — 구현 수준 이해 |
| **L3. 트레이드오프** | 대안과 비교, 왜 이 선택을 했는지 | 5년차 — 시스템 설계 관점 |
| **L4. CS 심화** | OS/DB/네트워크/알고리즘 레이어 원인 | 시니어 — Fundamentals |
| **L5. 실무 경험** | 실제 운영 중 겪은 사례, 실패/복구 | 시니어 — 경험 기반 판단력 |

> 면접관이 꼬리질문으로 갈수록 L1 → L5로 내려갑니다. **L4까지 답하면 시니어, L5까지 예시를 들면 글로벌 시니어 수준.**

---

## 작성 규칙

1. **실험 완료 직후 작성**: 수치와 관찰이 생생할 때
2. **실제 면접관 말투로**: "~를 설명해주세요", "그러면 ~는요?", "왜죠?"
3. **답변은 실측 수치 포함**: "87건이 사라졌습니다" > "많이 사라집니다"
4. **L5는 반드시 본인 경험이나 유명 사례**: 공허한 일반론 금지
5. **업데이트 가능**: 새로운 질문을 받으면 추가, 답변이 더 좋아지면 수정

---

## 주제 맵 (면접 토픽별 역참조)

주제로 찾고 싶을 때:

| 토픽 | 관련 Q&A |
|------|---------|
| **JPA Dirty Checking** | [track1-01-lost-update.md](concurrency-cache-lab/track1-01-lost-update.md) |
| **MVCC / InnoDB 락** | [track1-01-lost-update.md](concurrency-cache-lab/track1-01-lost-update.md) |
| **격리 수준 (Isolation Level)** | [track1-01-lost-update.md](concurrency-cache-lab/track1-01-lost-update.md) |
| **HikariCP 커넥션 풀** | [track1-01-lost-update.md](concurrency-cache-lab/track1-01-lost-update.md) |
| **Optimistic vs Pessimistic Lock** | [track1-01-lost-update.md](concurrency-cache-lab/track1-01-lost-update.md) |
| **외부 API 이중 호출 / 멱등성** | [track1-01-lost-update.md](concurrency-cache-lab/track1-01-lost-update.md) |
| **Two Generals' Problem** | [track1-01-lost-update.md](concurrency-cache-lab/track1-01-lost-update.md) |
| **RabbitMQ at-least-once + Dedup** | [track1-01-lost-update.md](concurrency-cache-lab/track1-01-lost-update.md) |
| synchronized 한계 (예정) | track1-02 |
| SELECT FOR UPDATE (예정) | track1-03 |
| Redisson watchdog (예정) | track1-04 |
| Cache Stampede (예정) | track3-02 |
| L1/L2 캐시 (예정) | track3-03 |
