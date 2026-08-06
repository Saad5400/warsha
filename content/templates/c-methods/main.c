#include <stdio.h>

// A function you call from main. C needs it defined (or prototyped) before use.
double average(const int *values, int count) {
    int sum = 0;
    for (int i = 0; i < count; i++) {
        sum += values[i];
    }
    return count > 0 ? (double) sum / count : 0.0;
}

const char *grade(double score) {
    if (score >= 90) return "excellent";
    if (score >= 60) return "passing";
    return "needs work";
}

int main(void) {
    int scores[] = {72, 88, 95, 51, 64};
    int n = (int) (sizeof scores / sizeof scores[0]);

    double avg = average(scores, n);
    printf("Average of %d scores: %.1f (%s)\n", n, avg, grade(avg));

    // Decide per value.
    for (int i = 0; i < n; i++) {
        printf("  %d -> %s\n", scores[i], grade(scores[i]));
    }

    // One number from you, graded the same way.
    int yours;
    printf("Enter a score: ");
    if (scanf("%d", &yours) == 1) {
        printf("You scored %d: %s\n", yours, grade(yours));
    }
    return 0;
}
