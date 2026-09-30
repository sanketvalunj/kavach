from collections import defaultdict
from threading import Lock


class RequestMetrics:
    def __init__(self) -> None:
        self._lock = Lock()
        self._counts: dict[tuple[str, str, str], int] = defaultdict(int)
        self._latency_sum: dict[str, float] = defaultdict(float)
        self._latency_max: dict[str, float] = defaultdict(float)

    def observe(self, method: str, route: str, status: int, elapsed_seconds: float) -> None:
        with self._lock:
            self._counts[(method, route, str(status))] += 1
            self._latency_sum[route] += elapsed_seconds
            self._latency_max[route] = max(self._latency_max[route], elapsed_seconds)

    def prometheus(self) -> str:
        with self._lock:
            counts = list(self._counts.items())
            sums = dict(self._latency_sum)
            maximums = dict(self._latency_max)
        lines = ["# HELP aegis_http_requests_total Total HTTP requests.", "# TYPE aegis_http_requests_total counter"]
        for (method, route, status), count in counts:
            lines.append(f'aegis_http_requests_total{{method="{method}",route="{route}",status="{status}"}} {count}')
        lines += ["# HELP aegis_http_request_duration_seconds_sum Cumulative HTTP request duration.", "# TYPE aegis_http_request_duration_seconds_sum counter"]
        for route, value in sums.items():
            lines.append(f'aegis_http_request_duration_seconds_sum{{route="{route}"}} {value:.6f}')
        lines += ["# HELP aegis_http_request_duration_seconds_max Maximum observed HTTP request duration.", "# TYPE aegis_http_request_duration_seconds_max gauge"]
        for route, value in maximums.items():
            lines.append(f'aegis_http_request_duration_seconds_max{{route="{route}"}} {value:.6f}')
        return "\n".join(lines) + "\n"


request_metrics = RequestMetrics()
