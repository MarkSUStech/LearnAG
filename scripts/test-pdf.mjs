// 生成测试 PDF 并验证提取（临时脚本）
import fs from 'node:fs'

const lines = [
  'TLS 握手流程测试文档',
  'ClientHello: 客户端发送支持的密码套件与随机数。',
  'ServerHello: 服务器选定套件并返回证书。',
  'Key Exchange: 完成密钥协商，派生会话密钥。',
  'Finished: 双方验证握手完整性，开始加密通信。',
]
let stream = 'BT /F1 14 Tf 60 760 Td 14 TL'
for (const l of lines) stream += ' (' + l.replace(/[()\\]/g, '') + ') Tj T*'
stream += ' ET'
const objs = []
objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
objs[4] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream'
objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
let pdf = '%PDF-1.4\n'
const offsets = []
for (let i = 1; i <= 5; i++) {
  offsets[i] = pdf.length
  pdf += i + ' 0 obj\n' + objs[i] + '\nendobj\n'
}
const xref = pdf.length
pdf += 'xref\n0 6\n0000000000 65535 f \n'
for (let i = 1; i <= 5; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF'

fs.mkdirSync('server/demo-vault/资料/TLS 握手', { recursive: true })
fs.writeFileSync('server/demo-vault/资料/TLS 握手/测试-TLS握手.pdf', pdf, 'binary')
console.log('test pdf written')

const { setVaultRoot } = await import('../server/vault.js')
setVaultRoot('C:/Dev/net/learn-agent/server/demo-vault')
const { extractPdfText } = await import('../server/agent/pdf.js')
const r = await extractPdfText('资料/TLS 握手/测试-TLS握手.pdf')
console.log('pages:', r.totalPages, '| truncated:', r.truncated)
console.log(r.content.slice(0, 400))
