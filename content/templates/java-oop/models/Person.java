package models; // this file lives in the models/ folder

/** A person with a name and an age. Other classes can extend this one. */
public class Person {

    // private means: only this class touches these values directly.
    private String name;
    private int age;

    /** A constructor builds the object. this.name is the field, name is the parameter. */
    public Person(String name, int age) {
        this.name = name;
        this.age = age;
    }

    // Getters let other classes read a private field.
    public String getName() {
        return name;
    }

    public int getAge() {
        return age;
    }

    /** A subclass may replace this method with its own version. */
    public String describe() {
        return name + ", age " + age;
    }
}
