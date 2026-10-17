import matplotlib.pyplot as plt



endpoints = [

    "Health\nCheck",

    "Admin\nStatistics",

    "Departments",

    "Patient\nRecords"

]



latency = [0.76, 1.44, 2.19, 2.32]



plt.figure(figsize=(8,5))

bars = plt.bar(endpoints, latency)



for bar, value in zip(bars, latency):

    plt.text(

        bar.get_x() + bar.get_width()/2,

        value + 0.05,

        f"{value:.2f}",

        ha='center'

    )



plt.ylabel("Median Response Time (ms)")

plt.xlabel("Endpoints")

plt.title("Fig. 4. Endpoint Response Time Analysis of the Proposed HMS")

plt.grid(axis='y', linestyle='--', alpha=0.5)



plt.tight_layout()

plt.savefig("fig4_endpoint_response_time.png", dpi=300)

plt.show()
