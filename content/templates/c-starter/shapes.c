#include "shapes.h"

double rectangle_area(Rectangle r) {
    return r.width * r.height;
}

double rectangle_perimeter(Rectangle r) {
    return 2 * (r.width + r.height);
}
