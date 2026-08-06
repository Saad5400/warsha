#include <stdio.h>

/* C starts here, in main(). Press Run. */
int main(void) {
    printf("=== Warsha C starter ===\n");

    // Typed variables: C needs a type for each one.
    int year = 2026;
    double pi = 3.14159;
    printf("year = %d, pi = %.2f\n", year, pi);

    // A loop.
    printf("Counting: ");
    for (int i = 1; i <= 5; i++) {
        printf("%d ", i);
    }
    printf("\n");

    // scanf reads what you type into the console.
    char name[64];
    printf("Your name: ");
    if (scanf("%63s", name) == 1) {
        printf("Hello, %s! Now edit main.c and press Run again.\n", name);
    }
    return 0;
}
