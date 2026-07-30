package models;

/** A Student is a Person with a major. extends reuses everything Person has. */
public class Student extends Person {

    private String major;

    public Student(String name, int age, String major) {
        super(name, age); // let Person store the name and the age first
        this.major = major;
    }

    /** Same name as Person.describe(), so it takes over for Students. */
    @Override
    public String describe() {
        return getName() + ", age " + getAge() + ", studies " + major;
    }
}
