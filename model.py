class Class:
    """
    Dai dien 1 buoi hoc cu the (1 session) duoc tao ra tu phan_cong_giang_day.
    - Moi ban ghi phan_cong_giang_day voi sobuoimoituan=2 se tao ra 2 doi tuong Class.
    - duration: so tiet lien tiep cua buoi hoc do (sotietmoibuoi).
    """

    def __init__(self, groups, teacher, subject, type, duration, classrooms, assignment_id=None):
        self.groups      = groups        # list[int]  - danh sach index cua lop hoc
        self.teacher     = teacher       # str        - ma giang vien (magv)
        self.subject     = subject       # str        - ma mon hoc (mamon)
        self.type        = type          # str        - 'LT' (ly thuyet) hoac 'TH' (thuc hanh)
        self.duration    = duration      # int        - so tiet lien tiep cua buoi hoc
        self.classrooms  = classrooms    # list[int]  - danh sach index phong hop le (theo loaiphong)
        # WHY added: de theo doi buoi hoc nay thuoc phan_cong_giang_day nao,
        # giup tinh soft constraint "cung mon cung ngay" chinh xac hon.
        self.assignment_id = assignment_id  # str | None - mapc tuong ung

    def __str__(self):
        return (
            "Lop {} | GV '{}' | Mon '{}' | Loai {} | {} tiet | Phong {} \n"
            .format(self.groups, self.teacher, self.subject,
                    self.type, self.duration, self.classrooms)
        )

    def __repr__(self):
        return str(self)


class Classroom:

    def __init__(self, name, type):
        self.name = name    # str - ma phong (maphong)
        self.type = type    # str - 'LT' hoac 'TH'

    def __str__(self):
        return "{} - {} \n".format(self.name, self.type)

    def __repr__(self):
        return str(self)


class Data:

    def __init__(self, groups, teachers, classes, classrooms,
                 teacher_specializations=None, subject_names=None):
        self.groups     = groups      # dict: malop -> index
        self.teachers   = teachers    # dict: magv  -> index
        self.classes    = classes     # dict: index -> Class
        self.classrooms = classrooms  # dict: index -> Classroom
        self.teacher_specializations = teacher_specializations or {}  # dict: magv -> chuyenmon
        self.subject_names           = subject_names or {}            # dict: mamon -> tenmon
