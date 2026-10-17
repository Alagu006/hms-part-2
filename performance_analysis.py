import requests
import time
import statistics

BASE_URL = "http://localhost:5000"

USER_ID = "ADMIN001"
PASSWORD = "Admin@123456"

session = requests.Session()

print("Getting CSRF token...")

csrf_response = session.get(
    f"{BASE_URL}/api/auth/csrf-token"
)

csrf_token = csrf_response.json()["csrfToken"]

print("CSRF Token acquired")

# Required cookie
session.cookies.set("x-csrf-token", csrf_token)

print("Logging in...")

login_response = session.post(
    f"{BASE_URL}/api/auth/login",
    headers={
        "X-CSRF-Token": csrf_token,
        "Content-Type": "application/json"
    },
    json={
    "username": "ADMIN001",
    "password": "Admin@123456"
}
)

print("Login Status:", login_response.status_code)
print(login_response.text)

if login_response.status_code != 200:
    raise Exception("Login failed")

print("\nLogin successful")

ENDPOINTS = [
    "/health",
    "/api/patients?limit=50",
    "/api/departments",
    "/api/admin/stats"
]

print("\nRunning benchmarks...\n")

for endpoint in ENDPOINTS:

    times = []

    # Warmup
    for _ in range(5):
        session.get(BASE_URL + endpoint)

    for _ in range(50):

        start = time.perf_counter()

        r = session.get(BASE_URL + endpoint)

        end = time.perf_counter()

        times.append((end - start) * 1000)

    median = statistics.median(times)
    mean = statistics.mean(times)

    p95 = sorted(times)[int(len(times) * 0.95) - 1]

    print("=" * 60)
    print(endpoint)
    print(f"Mean   : {mean:.2f} ms")
    print(f"Median : {median:.2f} ms")
    print(f"P95    : {p95:.2f} ms")
    print()