import QRCode from 'qrcode'

export async function generateQrDataUrl(text: string): Promise<string> {
  try {
    return await QRCode.toDataURL(text, {
      margin: 2,
      scale: 6,
      color: {
        dark: '#00f0ffff',
        light: '#0a0c14ff'
      }
    })
  } catch (err) {
    console.error('Failed to generate QR code', err)
    return ''
  }
}

export function encodeSignal(data: any): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))))
}

export function decodeSignal(str: string): any {
  return JSON.parse(decodeURIComponent(escape(atob(str))))
}
