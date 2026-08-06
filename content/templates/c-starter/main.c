#include <stdio.h>
#include "shapes.h"

int main(void) {
    // An array of rectangles — a loop over "objects", each its own struct.
    Rectangle shapes[] = {
        {3.0, 4.0},
        {5.0, 5.0},
        {2.5, 8.0},
    };
    int n = (int) (sizeof shapes / sizeof shapes[0]);

    printf("=== rectangles ===\n");
    for (int i = 0; i < n; i++) {
        Rectangle r = shapes[i];
        printf("%.1f x %.1f  area=%.1f  perimeter=%.1f\n",
               r.width, r.height, rectangle_area(r), rectangle_perimeter(r));
    }

    // Build one from your input, then reuse the same functions.
    Rectangle mine;
    printf("Width and height: ");
    if (scanf("%lf %lf", &mine.width, &mine.height) == 2) {
        printf("Your rectangle: area=%.1f  perimeter=%.1f\n",
               rectangle_area(mine), rectangle_perimeter(mine));
    }
    return 0;
}
