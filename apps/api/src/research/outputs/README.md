# Research outputs

`artifacts.ts` 将 Python 图片输出拆成文档私有的二进制产物，Cell JSON 只保存引用和展示信息。普通文档与嵌入分析共用这条链路。

`read-artifact.ts` 每次读取先校验文档归属，随后由 `routes/artifacts.ts` 返回字节；条件缓存也不能跳过归属校验。图片只与文档关联，删除执行诊断不会级联删除图片，删除文档会清理图片。

`fingerprints.ts` 提供内容比较及缓存使用的规范化哈希，不创建正式执行证据。这里没有源码快照、环境指纹、输入留存或回放。
