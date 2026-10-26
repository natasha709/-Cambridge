# TIS Paper Repository

A secure web-based examination & test paper repository for Biology and Chemistry (Year 7 to Year 13) with role-based subject access control, faculty management, and academic year filtering.

---

## Left Sidebar & Navigation Menu

1. **All Papers:** Overview link with total paper count.
2. **Administration (Clickable Header & Tab at Top):**
   - Click to switch directly to the **Faculty & Teachers Table**.
   - **View Details:** View full teacher profile, assigned subjects, and their uploaded papers with direct download links.
   - **Edit Teacher:** Update name, username, assigned subjects (`Biology`, `Chemistry`, or `Both`), and reset password.
   - **Delete Teacher:** Remove faculty members and revoke access.
   - **Add Teacher:** Pre-filled with the **default password `123`**.
3. **Subjects (Clickable Header & Section):**
   - 🧬 Biology (with live paper count)
   - ⚗️ Chemistry (with live paper count)
   *(Strictly scoped to assigned subjects for faculty members)*
4. **Years / Classes (Clickable Header & Section):**
   - Year 7 through Year 13 with live paper counts for each class.
5. **Academic Years (Clickable Header & Section):**
   - Examination & Academic Year filter: 2026, 2025, 2024, 2023, 2022... with live counts.

---

## Uploading Documents

- Teachers and administrators can click **"Upload Document"** directly from the top header or above the documents list.
- Quick modal allows selecting Class (Year 7–13), Subject (strictly Bio or Chem), Term (Term 1–3), and Academic Year, with drag-and-drop file attachment.

---

## Default Login Credentials

| Role | Username | Password | Subject Scope | Permissions |
| :--- | :--- | :--- | :--- | :--- |
| **School Administrator** | `admin` | `admin123` | Both Bio & Chem | Manage Teachers (Add, Edit, View Details, Delete), Upload/Delete Papers |
| **New Teachers Added** | *username* | **`123`** | Configured by Admin | Access and upload only their assigned subject |
| **Biology Faculty** | `bio_teacher` | `teacher123` | **Biology Only** | Upload, View, and Download Biology Papers ONLY |
| **Chemistry Faculty** | `chem_teacher` | `teacher123` | **Chemistry Only** | Upload, View, and Download Chemistry Papers ONLY |
| **Student / Member** | `student` | `student123` | Both Bio & Chem | View, Search, and Download Papers |

---

## How to Run

1. Open terminal:
   ```bash
   cd "c:\Users\THINKPAD\OneDrive\Desktop\TIS"
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open your browser:
   ```
   http://localhost:3000
   ```
