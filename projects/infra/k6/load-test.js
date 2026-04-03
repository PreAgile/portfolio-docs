/**
 * k6 부하테스트 스크립트 - platform-api
 *
 * 실행 방법:
 *   docker-compose run --rm k6 run /scripts/load-test.js
 *   또는 로컬: k6 run load-test.js
 *
 * 환경 변수:
 *   BASE_URL: 테스트 대상 서버 (기본: http://host.docker.internal:8080)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// 커스텀 메트릭
const errorRate = new Rate('errors');
const cacheHitRate = new Rate('cache_hits');
const dbQueryTime = new Trend('db_query_latency');

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:8080';

// ============================================================
// 테스트 시나리오 설정
// ============================================================
export const options = {
    scenarios: {
        // 시나리오 1: 점진적 부하 증가 (Ramp-up)
        ramp_up: {
            executor: 'ramping-vus',
            stages: [
                { duration: '1m', target: 50 },   // 워밍업
                { duration: '3m', target: 200 },   // 목표 부하
                { duration: '1m', target: 500 },   // 스파이크
                { duration: '1m', target: 200 },   // 복구 확인
                { duration: '1m', target: 0 },     // 종료
            ],
        },
    },

    // SLO (Service Level Objective)
    thresholds: {
        // P95 응답 시간 200ms 이하
        'http_req_duration': ['p(95)<200', 'p(99)<500'],
        // 에러율 1% 이하
        'errors': ['rate<0.01'],
        // 캐시 히트율 70% 이상 (목표)
        // 'cache_hits': ['rate>0.70'],
    },
};

// ============================================================
// 테스트 시나리오
// ============================================================
export default function () {
    group('가게 단건 조회 (캐시 히트 시나리오)', () => {
        // 자주 조회되는 가게 ID (캐시 히트 유도)
        const popularShopIds = [1, 2, 3, 4, 5];
        const shopId = popularShopIds[Math.floor(Math.random() * popularShopIds.length)];

        const res = http.get(`${BASE_URL}/api/v1/shops/${shopId}`, {
            headers: { 'Content-Type': 'application/json' },
            tags: { name: 'GET /shops/:id' },
        });

        const success = check(res, {
            'status is 200': (r) => r.status === 200,
            'response time < 50ms (캐시 히트)': (r) => r.timings.duration < 50,
            'body has shopId': (r) => JSON.parse(r.body).id === shopId,
        });

        errorRate.add(!success);
        // X-Cache-Status 헤더로 캐시 히트 여부 판단 (서버에서 헤더 추가 필요)
        cacheHitRate.add(res.headers['X-Cache-Status'] === 'HIT');
    });

    sleep(0.1); // 10ms 간격

    group('가게 목록 조회 (DB 조회 시나리오)', () => {
        const res = http.get(`${BASE_URL}/api/v1/shops?page=0&size=20`, {
            tags: { name: 'GET /shops' },
        });

        const success = check(res, {
            'status is 200': (r) => r.status === 200,
            'response time < 200ms': (r) => r.timings.duration < 200,
        });

        errorRate.add(!success);
        dbQueryTime.add(res.timings.duration);
    });

    sleep(0.5);
}

// ============================================================
// 테스트 완료 후 요약 출력
// ============================================================
export function handleSummary(data) {
    console.log('=== 부하테스트 결과 요약 ===');
    console.log(`총 요청 수: ${data.metrics.http_reqs.values.count}`);
    console.log(`평균 응답 시간: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms`);
    console.log(`P95 응답 시간: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms`);
    console.log(`P99 응답 시간: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms`);
    console.log(`에러율: ${(data.metrics.errors.values.rate * 100).toFixed(2)}%`);

    return {
        'stdout': JSON.stringify(data, null, 2),
        // Grafana 대시보드 연동을 위한 JSON 저장
        '/tmp/k6-result.json': JSON.stringify(data),
    };
}
