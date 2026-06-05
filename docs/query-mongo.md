# MongoDB & Mongoose Query Cheat Sheet

Tài liệu này tổng hợp các toán tử (operators) và phương thức truy vấn phổ biến nhất trong MongoDB và Mongoose, rất hữu ích khi bạn làm việc với NestJS.

---

## 1. Toán tử so sánh (Comparison Operators)
Dùng để lọc dữ liệu theo giá trị lớn, nhỏ, bằng...

| Toán tử | Ý nghĩa | Ví dụ | Giải thích |
|---------|---------|-------|------------|
| **`$eq`** | Equal (Bằng) | `{ age: { $eq: 25 } }` | Tìm tuổi đúng bằng 25. (Cách viết ngắn gọn: `{ age: 25 }`) |
| **`$ne`** | Not Equal (Khác) | `{ status: { $ne: "deleted" } }` | Lấy các bản ghi không có trạng thái là "deleted". |
| **`$gt`** | Greater Than (Lớn hơn) | `{ price: { $gt: 100 } }` | Giá lớn hơn 100. |
| **`$gte`**| Greater / Equal (Lớn hơn hoặc bằng) | `{ age: { $gte: 18 } }` | Tuổi >= 18. |
| **`$lt`** | Less Than (Nhỏ hơn) | `{ createdAt: { $lt: new Date() } }` | Thời gian tạo trước thời điểm hiện tại. |
| **`$lte`**| Less / Equal (Nhỏ hơn hoặc bằng) | `{ score: { $lte: 10 } }` | Điểm <= 10. |
| **`$in`** | In (Nằm trong danh sách) | `{ role: { $in: ["admin", "mod"] } }` | Tìm user có role là admin HOẶC mod. |
| **`$nin`**| Not In (Không nằm trong) | `{ status: { $nin: ["banned", "spam"] } }`| Loại bỏ các status là banned và spam. |

---

## 2. Toán tử logic (Logical Operators)
Dùng để kết hợp nhiều khối điều kiện tìm kiếm.

| Toán tử | Ý nghĩa | Ví dụ |
|---------|---------|-------|
| **`$and`** | VÀ (Tất cả phải đúng) | `{ $and: [ { price: { $lt: 100 } }, { inStock: true } ] }` |
| **`$or`** | HOẶC (Chỉ cần 1 cái đúng) | `{ $or: [ { score: { $gt: 90 } }, { isVip: true } ] }` |
| **`$not`** | PHỦ ĐỊNH (Đảo ngược) | `{ price: { $not: { $gt: 100 } } }` (Tương đương giá <= 100) |
| **`$nor`** | KHÔNG HOẶC (Đều sai) | `{ $nor: [ { isBanned: true }, { isDeleted: true } ] }` |

---

## 3. Toán tử mảng (Array Operators)
Chuyên dùng khi field trong database có kiểu dữ liệu là `Array`.

| Toán tử | Ý nghĩa | Ví dụ | Giải thích |
|---------|---------|-------|------------|
| **`$all`** | Chứa TẤT CẢ phần tử | `{ tags: { $all: ["tech", "js"] } }` | Mảng tags phải chứa cả "tech" và "js". |
| **`$elemMatch`** | Ít nhất 1 object trong mảng khớp toàn bộ điều kiện | `{ results: { $elemMatch: { score: 10, subject: "Toán" } } }` | Trong mảng results, phải có điểm 10 môn Toán. |
| **`$size`** | Kích thước mảng chính xác bằng số n | `{ comments: { $size: 5 } }` | Bài viết có đúng 5 bình luận. |

---

## 4. Toán tử tồn tại & Kiểu dữ liệu (Element)

| Toán tử | Ý nghĩa | Ví dụ |
|---------|---------|-------|
| **`$exists`** | Kiểm tra field có tồn tại hay không | `{ phone: { $exists: true } }` (Lọc ra những người có nhập số điện thoại) |
| **`$type`** | Lọc theo kiểu dữ liệu | `{ zipCode: { $type: "string" } }` (Tìm zipCode bị lưu nhầm thành string) |

---

## 5. Các phương thức phổ biến của Mongoose (NestJS hay dùng)

### 🟢 Lấy dữ liệu (Read)
- `Model.find(query)`: Lấy mảng tất cả các document khớp điều kiện.
- `Model.findOne(query)`: Lấy đúng 1 document đầu tiên tìm thấy (trả về Object hoặc null).
- `Model.findById(id)`: Tương đương `findOne({ _id: id })`. Lấy theo ID.

### 🔵 Tạo dữ liệu (Create)
- `Model.create(data)`: Tạo và lưu trực tiếp xuống DB.
- `new Model(data).save()`: Tạo một instance của Mongoose, có thể chỉnh sửa thêm trước khi gọi `.save()`.

### 🟡 Cập nhật dữ liệu (Update)
- `Model.updateOne(query, update)`: Cập nhật 1 document đầu tiên khớp điều kiện.
- `Model.updateMany(query, update)`: Cập nhật toàn bộ các document khớp điều kiện.
- `Model.findByIdAndUpdate(id, update, { new: true })`: Cập nhật theo ID. **Lưu ý:** Thêm `{ new: true }` để hàm trả về object SAU khi cập nhật (mặc định trả về object trước cập nhật).

**Các toán tử dùng khi Update:**
- **`$set`**: Đổi/Thêm giá trị field (`{ $set: { name: "Tom" } }`)
- **`$unset`**: Xóa hẳn field khỏi DB (`{ $unset: { oldPhone: "" } }`)
- **`$inc`**: Tăng/Giảm giá trị dạng số (`{ $inc: { views: 1, money: -50 } }`)
- **`$push`**: Thêm 1 phần tử vào cuối mảng (`{ $push: { tags: "hot" } }`)
- **`$pull`**: Xóa phần tử ra khỏi mảng (`{ $pull: { tags: "spam" } }`)
- **`$addToSet`**: Thêm vào mảng nhưng **không cho trùng lặp** (giống Push nhưng độc nhất).

### 🔴 Xóa dữ liệu (Delete)
- `Model.deleteOne(query)`: Xóa 1 bản ghi.
- `Model.deleteMany(query)`: Xóa nhiều bản ghi.
- `Model.findByIdAndDelete(id)`: Xóa theo ID.

---

## 6. Tinh chỉnh truy vấn (Query Modifiers - Chainable)
Mongoose cho phép nối (chain) các hàm lại với nhau để điều khiển kết quả:

- `.sort({ createdAt: -1 })`: Sắp xếp. `1` là tăng dần (cũ nhất trước), `-1` là giảm dần (mới nhất trước).
- `.limit(20)`: Chỉ lấy tối đa 20 bản ghi (dùng trong phân trang).
- `.skip(40)`: Bỏ qua 40 bản ghi đầu tiên (dùng cùng limit để làm Offset Pagination).
- `.select('name email -password')`: **Chỉ định các cột muốn lấy**. Ví dụ lấy `name`, `email` nhưng **LOẠI BỎ** `-password`.
- `.populate('userId', 'name avatar')`: Dùng để **JOIN** sang collection khác. Ví dụ từ khóa ngoại `userId`, lấy chi tiết bảng User (chỉ lấy field name, avatar).
