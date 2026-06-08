# Redis methods cheat sheet

File này là ghi chú nhanh về các nhóm lệnh Redis hay gặp:

- method làm gì
- ví dụ ngắn
- khi nào nên dùng

File này ưu tiên thực dụng, không cố liệt kê 100% toàn bộ command của Redis. Phần đầu là những lệnh hay dùng nhất khi đi làm và cũng là những lệnh sát với app chat này. Phần sau vẫn chia nhóm để tiện tra cứu.

## 1. Những lệnh thường dùng nhất

Nếu học để đi làm trước, hoặc để làm app này trước, nên nhớ mấy lệnh sau:

### Nhóm đọc / ghi cơ bản

- `SET`: lưu 1 key
- `GET`: đọc 1 key
- `MGET`: đọc nhiều key cùng lúc
- `DEL`: xóa key
- `EXISTS`: kiểm tra key có tồn tại không

Ví dụ:

```text
SET presence:user:123 online
GET presence:user:123
MGET presence:user:1 presence:user:2 presence:user:3
DEL presence:user:123
EXISTS presence:user:123
```

### Nhóm TTL rất hay dùng

- `EXPIRE`: gắn thời gian sống cho key
- `TTL`: xem key còn sống bao lâu
- `SETEX`: set value + TTL trong một lệnh

Ví dụ:

```text
EXPIRE presence:user:123 60
TTL presence:user:123
SETEX presence:user:123 60 online
```

### Nhóm Set cực hay dùng cho app

- `SADD`: thêm phần tử vào set
- `SREM`: xóa phần tử khỏi set
- `SMEMBERS`: lấy toàn bộ phần tử trong set
- `SISMEMBER`: check một phần tử có nằm trong set không

Ví dụ:

```text
SADD unseen:conversations:123 convA
SREM unseen:conversations:123 convA
SMEMBERS unseen:conversations:123
SISMEMBER unseen:conversations:123 convA
```

### Nhóm counter hay gặp

- `INCR`
- `DECR`
- `INCRBY`

Ví dụ:

```text
INCR counter:page:view
DECR stock:item:1
INCRBY score:user:1 10
```

### Nhóm debug / duyệt key

- `SCAN`: duyệt key an toàn hơn `KEYS`
- `TYPE`: xem kiểu dữ liệu

Ví dụ:

```text
SCAN 0 MATCH presence:user:* COUNT 100
TYPE unseen:conversations:123
```

### Nhóm batch rất hay dùng trong code

- `pipeline`: gom nhiều lệnh Redis rồi chạy một lần

Ví dụ:

```ts
const pipeline = redis.pipeline();
pipeline.get('presence:user:1');
pipeline.get('presence:user:2');
const results = await pipeline.exec();
```

## 2. Những lệnh dùng nhiều trong app chat này

Nếu chỉ xét app hiện tại thì các lệnh bạn dùng nhiều nhất là:

- `SETEX` hoặc `SET ... EX ...`
- `GET`
- `MGET`
- `TTL`
- `SADD`
- `SREM`
- `SMEMBERS`
- `pipeline`

### Mapping nhanh với app hiện tại

- Online/offline:
  - `SETEX`
  - `GET`
  - `MGET`
  - `TTL`

- Unseen conversation:
  - `SADD`
  - `SREM`
  - `SMEMBERS`

- Tối ưu nhiều user online:
  - `pipeline`

## 3. String commands

### `SET`

Lưu một key với value.

```text
SET user:1 online
```

### `GET`

Lấy value của một key.

```text
GET user:1
```

### `MGET`

Lấy value của nhiều key cùng lúc.

```text
MGET user:1 user:2 user:3
```

Ví dụ kết quả:

```text
[online, nil, online]
```

### `DEL`

Xóa key.

```text
DEL user:1
```

### `EXISTS`

Kiểm tra key có tồn tại không.

```text
EXISTS user:1
```

Kết quả:

- `1`: có tồn tại
- `0`: không tồn tại

### `APPEND`

Nối thêm chuỗi vào cuối value hiện tại.

```text
APPEND log:1 " hello"
```

### `GETRANGE`

Lấy một phần chuỗi theo vị trí.

```text
GETRANGE article:1 0 9
```

### `SETRANGE`

Ghi đè một đoạn của chuỗi từ vị trí chỉ định.

```text
SETRANGE article:1 0 "Hello"
```

## 4. TTL commands

### `EXPIRE`

Gắn thời gian sống cho key.

```text
EXPIRE user:1 60
```

### `PEXPIRE`

Giống `EXPIRE` nhưng tính theo millisecond.

```text
PEXPIRE user:1 1500
```

### `TTL`

Xem key còn sống bao nhiêu giây.

```text
TTL user:1
```

Kết quả thường gặp:

- `> 0`: số giây còn lại
- `-1`: key tồn tại nhưng không có TTL
- `-2`: key không tồn tại

### `PTTL`

Giống `TTL` nhưng trả về millisecond.

```text
PTTL user:1
```

### `SETEX`

Set value và gắn TTL trong một lệnh.

```text
SETEX user:1 60 online
```

### `PSETEX`

Giống `SETEX` nhưng TTL theo millisecond.

```text
PSETEX user:1 1500 online
```

### `PERSIST`

Xóa TTL của key, giữ key sống vô thời hạn.

```text
PERSIST user:1
```

## 5. Numeric commands

### `INCR`

Tăng giá trị số lên 1.

```text
INCR counter:page:view
```

### `DECR`

Giảm giá trị số xuống 1.

```text
DECR stock:item:1
```

### `INCRBY`

Tăng giá trị số theo bước chỉ định.

```text
INCRBY score:user:1 10
```

### `DECRBY`

Giảm giá trị số theo bước chỉ định.

```text
DECRBY stock:item:1 2
```

### `INCRBYFLOAT`

Tăng số thực.

```text
INCRBYFLOAT wallet:user:1 12.5
```

## 6. Hash commands

Hash hợp khi muốn lưu nhiều field trong một object nhỏ.

Ví dụ:

```text
user:1 => {name, email, status}
```

### `HSET`

Set một hoặc nhiều field của hash.

```text
HSET user:1 name "An" email "an@test.com" status "online"
```

### `HGET`

Lấy value của một field.

```text
HGET user:1 email
```

### `HMGET`

Lấy nhiều field cùng lúc.

```text
HMGET user:1 name status
```

### `HGETALL`

Lấy toàn bộ field và value của hash.

```text
HGETALL user:1
```

### `HDEL`

Xóa một hoặc nhiều field khỏi hash.

```text
HDEL user:1 status
```

### `HEXISTS`

Kiểm tra field có tồn tại không.

```text
HEXISTS user:1 email
```

### `HINCRBY`

Tăng giá trị số của một field trong hash.

```text
HINCRBY stats:post:1 views 1
```

### `HKEYS`

Lấy danh sách field.

```text
HKEYS user:1
```

### `HVALS`

Lấy danh sách value.

```text
HVALS user:1
```

## 7. List commands

List hợp khi cần queue hoặc danh sách có thứ tự.

### `LPUSH`

Thêm phần tử vào đầu list.

```text
LPUSH jobs pending
```

### `RPUSH`

Thêm phần tử vào cuối list.

```text
RPUSH jobs done
```

### `LPOP`

Lấy và xóa phần tử đầu list.

```text
LPOP jobs
```

### `RPOP`

Lấy và xóa phần tử cuối list.

```text
RPOP jobs
```

### `LRANGE`

Lấy một đoạn phần tử trong list.

```text
LRANGE jobs 0 -1
```

### `LLEN`

Đếm số phần tử trong list.

```text
LLEN jobs
```

### `LINDEX`

Lấy phần tử tại một vị trí.

```text
LINDEX jobs 0
```

### `LSET`

Gán lại phần tử tại một vị trí.

```text
LSET jobs 0 processing
```

## 8. Set commands

Set hợp khi cần tập hợp không trùng lặp.

### `SADD`

Thêm phần tử vào set.

```text
SADD tags:post:1 redis
```

Kết quả:

- `1`: phần tử được thêm mới
- `0`: phần tử đã tồn tại từ trước

### `SREM`

Xóa phần tử khỏi set.

```text
SREM tags:post:1 redis
```

### `SMEMBERS`

Lấy toàn bộ phần tử trong set.

```text
SMEMBERS tags:post:1
```

### `SISMEMBER`

Kiểm tra phần tử có nằm trong set không.

```text
SISMEMBER tags:post:1 redis
```

### `SCARD`

Đếm số phần tử trong set.

```text
SCARD tags:post:1
```

### `SPOP`

Lấy và xóa ngẫu nhiên một phần tử.

```text
SPOP tags:post:1
```

### `SRANDMEMBER`

Lấy ngẫu nhiên một phần tử nhưng không xóa.

```text
SRANDMEMBER tags:post:1
```

### `SUNION`

Lấy hợp của nhiều set.

```text
SUNION set:a set:b
```

### `SINTER`

Lấy giao của nhiều set.

```text
SINTER set:a set:b
```

### `SDIFF`

Lấy phần tử có trong set đầu nhưng không có trong set sau.

```text
SDIFF set:a set:b
```

## 9. Sorted Set commands

Sorted Set hợp khi cần xếp hạng theo điểm.

### `ZADD`

Thêm phần tử với score.

```text
ZADD leaderboard 100 user:1 95 user:2
```

### `ZRANGE`

Lấy phần tử theo thứ tự score.

```text
ZRANGE leaderboard 0 -1
```

### `ZREVRANGE`

Lấy phần tử theo score giảm dần.

```text
ZREVRANGE leaderboard 0 9
```

### `ZSCORE`

Lấy score của một member.

```text
ZSCORE leaderboard user:1
```

### `ZRANK`

Lấy thứ hạng tăng dần của member.

```text
ZRANK leaderboard user:1
```

### `ZREVRANK`

Lấy thứ hạng giảm dần của member.

```text
ZREVRANK leaderboard user:1
```

### `ZREM`

Xóa member khỏi sorted set.

```text
ZREM leaderboard user:2
```

### `ZCARD`

Đếm số member.

```text
ZCARD leaderboard
```

## 10. Key commands

### `KEYS`

Tìm key theo pattern.

```text
KEYS user:*
```

Không nên dùng `KEYS` trên production dataset lớn vì có thể block.

### `SCAN`

Duyệt key theo từng đợt, an toàn hơn `KEYS`.

```text
SCAN 0 MATCH user:* COUNT 100
```

### `TYPE`

Xem kiểu dữ liệu của key.

```text
TYPE user:1
```

### `RENAME`

Đổi tên key.

```text
RENAME user:1 user:100
```

### `UNLINK`

Xóa key bất đồng bộ, nhẹ hơn `DEL` trong vài trường hợp.

```text
UNLINK cache:big:1
```

## 11. Transaction và optimistic locking

### `MULTI`

Bắt đầu transaction.

```text
MULTI
```

### `EXEC`

Chạy transaction.

```text
EXEC
```

### `DISCARD`

Hủy transaction đang chờ.

```text
DISCARD
```

### `WATCH`

Theo dõi key để làm optimistic locking.

```text
WATCH balance:user:1
```

Ý tưởng:

- đọc key
- chuẩn bị ghi
- nếu key bị đổi bởi client khác trước `EXEC` thì transaction fail

## 12. Pub/Sub commands

Pub/Sub hợp khi cần phát tín hiệu realtime giữa publisher và subscriber.

### `PUBLISH`

Phát message lên channel.

```text
PUBLISH chat-events "new-message"
```

### `SUBSCRIBE`

Lắng nghe channel.

```text
SUBSCRIBE chat-events
```

### `PSUBSCRIBE`

Subscribe theo pattern.

```text
PSUBSCRIBE chat-*
```

## 13. Stream commands

Redis Streams hợp khi cần event log hoặc consumer groups.

### `XADD`

Thêm event vào stream.

```text
XADD orders * userId 1 total 99
```

### `XRANGE`

Đọc event theo khoảng id.

```text
XRANGE orders - +
```

### `XREAD`

Đọc stream từ id chỉ định.

```text
XREAD COUNT 10 STREAMS orders 0
```

### `XGROUP`

Quản lý consumer group cho stream.

```text
XGROUP CREATE orders workers 0
```

### `XREADGROUP`

Đọc stream theo consumer group.

```text
XREADGROUP GROUP workers c1 COUNT 10 STREAMS orders >
```

## 14. Bitmap commands

Bitmap hợp khi lưu cờ nhị phân rất lớn.

### `SETBIT`

Set bit tại offset.

```text
SETBIT online:days 5 1
```

### `GETBIT`

Lấy bit tại offset.

```text
GETBIT online:days 5
```

### `BITCOUNT`

Đếm số bit đang bật.

```text
BITCOUNT online:days
```

## 15. HyperLogLog commands

HyperLogLog hợp khi cần ước lượng số phần tử unique với bộ nhớ nhỏ.

### `PFADD`

Thêm phần tử.

```text
PFADD visitors ip1 ip2 ip3
```

### `PFCOUNT`

Ước lượng số phần tử unique.

```text
PFCOUNT visitors
```

### `PFMERGE`

Gộp nhiều HyperLogLog.

```text
PFMERGE visitors:all visitors:web visitors:app
```

## 16. Geo commands

Geo hợp khi lưu vị trí địa lý.

### `GEOADD`

Thêm tọa độ.

```text
GEOADD stores 106.7 10.7 hcm_store
```

### `GEOPOS`

Lấy tọa độ.

```text
GEOPOS stores hcm_store
```

### `GEODIST`

Tính khoảng cách.

```text
GEODIST stores hcm_store hn_store km
```

### `GEOSEARCH`

Tìm điểm trong bán kính hoặc vùng.

```text
GEOSEARCH stores FROMLONLAT 106.7 10.7 BYRADIUS 5 km
```

## 17. Batch commands với `pipeline`

`pipeline` là cách gom nhiều lệnh lại rồi gửi một lần.

Nó hữu ích khi:

- cần chạy nhiều lệnh giống nhau
- muốn giảm số lần round-trip tới Redis

Ví dụ:

```ts
const pipeline = redis.pipeline();

pipeline.get('user:1');
pipeline.get('user:2');
pipeline.get('user:3');

const results = await pipeline.exec();
```

Ví dụ kết quả:

```ts
[
  [null, 'online'],
  [null, null],
  [null, 'online'],
]
```

## 18. Khi nào dùng cấu trúc nào

### String

Dùng khi:

- lưu một value đơn
- token
- OTP
- status ngắn

### Hash

Dùng khi:

- lưu object nhỏ
- profile ngắn
- config theo field

### List

Dùng khi:

- queue đơn giản
- danh sách có thứ tự

### Set

Dùng khi:

- membership
- tag
- danh sách id không trùng

### Sorted Set

Dùng khi:

- leaderboard
- ranking
- sắp xếp theo score hoặc thời gian

### Stream

Dùng khi:

- event log
- queue nhiều consumer
- cần ack/consumer group

## 19. Ghi nhớ nhanh

Nhóm lệnh nên nhớ trước:

- `SET`, `GET`, `MGET`, `DEL`, `EXISTS`
- `EXPIRE`, `TTL`, `SETEX`
- `INCR`, `DECR`, `INCRBY`
- `HSET`, `HGET`, `HGETALL`
- `LPUSH`, `RPUSH`, `LPOP`, `LRANGE`
- `SADD`, `SREM`, `SMEMBERS`, `SISMEMBER`
- `ZADD`, `ZRANGE`, `ZREVRANGE`, `ZSCORE`
- `SCAN`
- `MULTI`, `EXEC`, `WATCH`
- `PUBLISH`, `SUBSCRIBE`
- `XADD`, `XREAD`
- `pipeline`

## 20. Ghi chú

- `KEYS` tiện để học và debug nhưng không nên lạm dụng ở production lớn.
- `SCAN` thường an toàn hơn `KEYS`.
- Nếu cần áp dụng các method này vào flow của app chat thì xem ở `docs/plan.md`.
