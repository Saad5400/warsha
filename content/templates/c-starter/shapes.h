#ifndef SHAPES_H
#define SHAPES_H

// A rectangle: its data (width, height) and the operations on it, declared here
// and defined in shapes.c. main.c includes this header to use them.
typedef struct {
    double width;
    double height;
} Rectangle;

double rectangle_area(Rectangle r);
double rectangle_perimeter(Rectangle r);

#endif
