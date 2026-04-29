$authFile = 'C:\Users\Sumayyah\Desktop\project\HNGTASK1\src\middleware\auth.js'
$content = Get-Content $authFile -Raw

# Add logging after token verification
$newContent = $content -replace `
  "(const payload = verifyAccessToken\(token, config\);`n      if \(!payload\) {`n        )", `
  "`$1console.error('[AUTH] Token verification failed');`n        "

# Add logging after user lookup
$newContent = $newContent -replace `
  "(const user = await db\.collection\('users'\)\.findOne\(\{ id: payload\.sub \}[^)]*\);`n`n      if \(!user\) {`n        console\.error\(`'Auth: User not found)", `
  "`$1;`n      console.log('[AUTH] Looking up user with ID:', payload.sub);`n      if (!user) {`n        console.error('[AUTH] User not found for ID:', payload.sub);"

Set-Content $authFile $newContent
Write-Host "✅ Logging added to auth middleware"
Write-Host "Run the backend and then test whoami to see logs"
