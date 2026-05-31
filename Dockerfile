# Stage 1: Build ứng dụng NestJS
FROM node:20-alpine AS builder

WORKDIR /app

# Sao chép package.json và package-lock.json để tận dụng cache
COPY package*.json ./
RUN npm ci

# Sao chép toàn bộ mã nguồn
COPY . .

# Biên dịch TypeScript sang JavaScript
RUN npm run build

# Stage 2: Môi trường chạy tối giản (Runtime)
FROM node:20-alpine AS runner

WORKDIR /app

# Chỉ cài đặt dependencies cho production để giảm dung lượng ảnh
COPY package*.json ./
RUN npm ci --only=production

# Sao chép file build từ Stage 1
COPY --from=builder /app/dist ./dist

# SAO CHÉP ASSETS (mail templates) vào thư mục chạy
# Vì NestJS build không tự gom các file non-JS vào dist nếu không cấu hình assets sao chép chuẩn
COPY --from=builder /app/dist/mail/template ./dist/mail/template

# Mặc định Hugging Face Spaces yêu cầu Web Server phải lắng nghe trên cổng 7860
ENV PORT=7860
EXPOSE 7860

# Khởi động ứng dụng
CMD ["node", "dist/main"]
