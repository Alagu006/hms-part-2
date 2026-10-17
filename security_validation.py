import requests

import time

from tabulate import tabulate



BASE_URL = "http://localhost:5000"



ADMIN_USER = "ADMIN001"

ADMIN_PASS = "Admin@123456"



results = []





def add_result(mechanism, scenario, expected, observed):

    results.append([mechanism, scenario, expected, observed])





session = requests.Session()



print("Getting CSRF Token...")



try:

    csrf_resp = session.get(f"{BASE_URL}/api/auth/csrf-token")

    csrf_token = csrf_resp.json().get("csrfToken")



    headers = {

        "x-csrf-token": csrf_token

    }



except Exception as e:

    print("Failed to obtain CSRF token:", e)

    exit()





# ----------------------------------------------------

# VALID LOGIN

# ----------------------------------------------------



try:

    login_resp = session.post(

        f"{BASE_URL}/api/auth/login",

        json={

            "username": ADMIN_USER,

            "password": ADMIN_PASS

        },

        headers=headers

    )



    if login_resp.status_code == 200:

        add_result(

            "User Authentication",

            "Valid login credentials",

            "Access granted",

            "Passed"

        )

    else:

        add_result(

            "User Authentication",

            "Valid login credentials",

            "Access granted",

            f"Failed ({login_resp.status_code})"

        )



except Exception as e:

    add_result(

        "User Authentication",

        "Valid login credentials",

        "Access granted",

        f"Error: {e}"

    )





# ----------------------------------------------------

# INVALID LOGIN

# ----------------------------------------------------



try:

    bad_login = session.post(

        f"{BASE_URL}/api/auth/login",

        json={

            "username": ADMIN_USER,

            "password": "WrongPassword123"

        },

        headers=headers

    )



    if bad_login.status_code in [400, 401, 403, 422]:

        add_result(

            "User Authentication",

            "Invalid credentials",

            "Access denied",

            "Passed"

        )

    else:

        add_result(

            "User Authentication",

            "Invalid credentials",

            "Access denied",

            "Failed"

        )



except Exception as e:

    add_result(

        "User Authentication",

        "Invalid credentials",

        "Access denied",

        f"Error: {e}"

    )





# ----------------------------------------------------

# JWT VALIDATION

# ----------------------------------------------------



try:

    fake_headers = {

        "Authorization": "Bearer fake.jwt.token"

    }



    jwt_test = requests.get(

        f"{BASE_URL}/api/patients",

        headers=fake_headers

    )



    if jwt_test.status_code in [401, 403]:

        add_result(

            "JWT Token Validation",

            "Expired/invalid token",

            "Request rejected",

            "Passed"

        )

    else:

        add_result(

            "JWT Token Validation",

            "Expired/invalid token",

            "Request rejected",

            "Failed"

        )



except Exception as e:

    add_result(

        "JWT Token Validation",

        "Expired/invalid token",

        "Request rejected",

        f"Error: {e}"

    )





# ----------------------------------------------------

# CSRF PROTECTION

# ----------------------------------------------------



try:

    csrf_fail = requests.post(

        f"{BASE_URL}/api/auth/login",

        json={

            "username": ADMIN_USER,

            "password": ADMIN_PASS

        }

    )



    if csrf_fail.status_code in [403, 401]:

        add_result(

            "CSRF Protection",

            "Request without valid CSRF token",

            "Request blocked",

            "Passed"

        )

    else:

        add_result(

            "CSRF Protection",

            "Request without valid CSRF token",

            "Request blocked",

            "Failed"

        )



except Exception as e:

    add_result(

        "CSRF Protection",

        "Request without valid CSRF token",

        "Request blocked",

        f"Error: {e}"

    )





# ----------------------------------------------------

# RATE LIMITING

# ----------------------------------------------------



try:

    rate_limit_hit = False



    for i in range(300):

        r = requests.get(f"{BASE_URL}/health")



        if r.status_code == 429:

            rate_limit_hit = True

            break



    add_result(

        "Rate Limiting",

        "Excessive requests from same client",

        "Requests throttled",

        "Passed" if rate_limit_hit else "Not Triggered"

    )



except Exception as e:

    add_result(

        "Rate Limiting",

        "Excessive requests from same client",

        "Requests throttled",

        f"Error: {e}"

    )





# ----------------------------------------------------

# RBAC TEST

# ----------------------------------------------------

# Requires a non-admin account

# Modify endpoint accordingly



add_result(

    "Role-Based Access Control (RBAC)",

    "Unauthorized role accessing protected resource",

    "Access denied",

    "Manual Verification Required"

)





# ----------------------------------------------------

# RESOURCE OWNERSHIP

# ----------------------------------------------------



add_result(

    "Resource Ownership Verification",

    "User accessing another user's records",

    "Access denied",

    "Manual Verification Required"

)





# ----------------------------------------------------

# AUDIT LOGGING

# ----------------------------------------------------



add_result(

    "Audit Logging",

    "Security-sensitive action performed",

    "Audit record created",

    "Verify audit table manually"

)





# ----------------------------------------------------

# AUDIT INTEGRITY

# ----------------------------------------------------



add_result(

    "Audit Integrity Verification",

    "Modified audit record",

    "Tampering detected",

    "Verify manually"

)





# ----------------------------------------------------

# SESSION MANAGEMENT

# ----------------------------------------------------



add_result(

    "Session Management",

    "Revoked session token",

    "Access denied",

    "Manual Verification Required"

)





# ----------------------------------------------------

# PRINT REPORT

# ----------------------------------------------------



print("\n")

print("=" * 120)

print("SECURITY VALIDATION REPORT")

print("=" * 120)



print(

    tabulate(

        results,

        headers=[

            "Security Mechanism",

            "Validation Scenario",

            "Expected Result",

            "Observed Result"

        ],

        tablefmt="grid"

    )

)
