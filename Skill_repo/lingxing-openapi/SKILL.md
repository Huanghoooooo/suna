---
name: lingxing-openapi
description: Use when working with LingXing ERP OpenAPI, especially for obtaining access_token, refreshing tokens, generating sign signatures, and calling signed business APIs such as seller lists or marketplace mappings.
---

# LingXing OpenAPI

Use this skill when the task involves LingXing ERP OpenAPI authentication or signed requests.

## Scope

- Get `access_token` from `/api/auth-server/oauth/access-token`
- Refresh token from `/api/auth-server/oauth/refresh`
- Generate `sign` for GET or POST business APIs
- Assemble signed URLs for endpoints like seller list and marketplace list

## Key Rules

- Auth endpoints use `application/x-www-form-urlencoded`
- Business requests include public params on the URL:
  - `access_token`
  - `app_key`
  - `timestamp`
  - `sign`
- `sign` must be URL encoded before transmission
- `timestamp` should be real-time because the sign expires after about 2 minutes
- For POST JSON bodies, nested objects or arrays must be converted to strings before signing
- Empty-string values do not participate in signing
- `null` values do participate in signing

## Signing Algorithm

1. Collect all business params plus `access_token`, `app_key`, and `timestamp`
2. Sort by parameter name in ASCII order
3. Join as `key=value&key=value`
4. Compute MD5 of the joined string and uppercase the hex digest
5. Encrypt that MD5 string using `AES/ECB/PKCS5PADDING` with `appId` as the AES key
6. Base64 encode the AES ciphertext
7. URL encode the Base64 string and send it as `sign`

## Bundled Scripts

- `scripts/get_access_token.py`
  Gets `access_token` and `refresh_token`
- `scripts/sign_request.py`
  Generates a LingXing `sign` and prints the signed query string

## Suggested Workflow

1. Run `get_access_token.py` with `appId` and `appSecret`
2. Build request params for the target API
3. Run `sign_request.py` with `appId` and request params
4. Send the request with all params on the URL

## Examples

Get token:

```bash
python3 lingxing-openapi-skill/scripts/get_access_token.py \
  --app-id 'ak_xxx' \
  --app-secret 'secret'
```

Generate signed query for seller list:

```bash
python3 lingxing-openapi-skill/scripts/sign_request.py \
  --app-id 'ak_xxx' \
  --access-token 'token' \
  --param offset=0 \
  --param length=100
```

## Notes

- If the API returns `ip not permit`, add the current egress IP to LingXing's whitelist
- If the API returns `api sign has expired`, regenerate `timestamp` and `sign`
- If the API returns `api sign not correct`, verify sort order, URL encoding, and nested-body stringification
