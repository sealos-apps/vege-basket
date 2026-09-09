type VerificationPackageDownload = {
  downloadUrl: string
  objectKey: string
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function archiveFileName(objectKey: string, index: number, usedNames: Set<string>) {
  const candidate = objectKey.split('/').at(-1)?.replace(/[^A-Za-z0-9._-]/gu, '-') || `package-${index + 1}.tar`
  const stem = candidate.replace(/(\.[A-Za-z0-9]+)?$/u, '') || `package-${index + 1}`
  const extension = candidate.slice(stem.length)
  let fileName = candidate
  let duplicate = 2
  while (usedNames.has(fileName)) {
    fileName = `${stem}-${duplicate}${extension}`
    duplicate += 1
  }
  usedNames.add(fileName)
  return fileName
}

export function createPackageVerificationScript(packages: readonly VerificationPackageDownload[]) {
  const usedNames = new Set<string>()
  return packages.map((item, index) => {
    const fileName = archiveFileName(item.objectKey, index, usedNames)
    return `wget ${shellQuote(item.downloadUrl)} -O ${shellQuote(fileName)} && sealos run -f ${shellQuote(fileName)}`
  }).join(' && \\\n')
}

export function createClusterImageVerificationScript(images: readonly string[]) {
  return images.map((image) => `sealos run -f ${shellQuote(image)}`).join(' && \\\n')
}
