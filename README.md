# scirocco
this modules keeps json-apis safe from format checking

## Idea/Sample
http-apis always follow the same pattern:
1. a request is recieved and checked if all necessary arguments were sent
2. arguments get extracted
3. **the magic happens**
4. result is packed into the response object
5. response is being sent back

This structure can be simplified with this module, while also enhancing types. The following example will hash a password which is url-encoded - *insecure!*. Types were sometimes added to help understanding.
1. create a SourceType and a TargetType for your callback action:
```typescript
//hash.ts
export interface IHashSource { password: string; }
export interface IHashTarget { hash: string; salt: string; }
```
2. create a type-guard:
```typescript
//hash.ts
const HashGuard = (object: any): object is IHashSource =>
    "password" in object && typeof object.password === "string";
```
3. export a guarded callback:
```typescript
//hash.ts
import * as crypto from "crypto";
import { secure } from "scirocco";

const hash = (payload: string) => {
    const salt = crypto.randomBytes(Math.ceil(64 / 2)).toString("hex").slice(0, 64);
    return { salt, hash: crypto.createHmac("sha512", salt).update(payload).digest("hex") };
};

export const callback = secure<IHashSource, IHashTarget>(HashGuard, (source) =>
    hash(source.password));
```
4. import the callback and the types into your expressjs router:
```typescript
// router.ts
import { Request, Router } from "express";
import { scaffold } from "scirocco";
import { callback, IHashSource, IHashTarget } from "./hash";

interface IHashResponse { hash: string; }

const router: Router = Router();
```
5. scaffold the expressjs request-handler - using a construct-callback which selects the
necessary request arguments (like req.query.password), the callback and a destruct-callback
which reduces the result from the callback (destruct-callback is optional)
```typescript
// router.ts
router.get("/hash", scaffold<IHashSource, IHashTarget, IHashResponse>(
    (req: Request): IHashSource => ({ password: req.query.password }),
    callback,
    (data: IHashTarget, req: Request, res: Response) => ({ hash: data.hash })));
```
6. done! you now have a exception stable, format secure and type-asserted request handler to
hash a password (**NOTICE: the hashing mechanism show here might not be secure - do not copy & paste this example for production**) 

The full code should look like this:
```typescript
// hash.ts
import * as crypto from "crypto";
import { scaffold } from "scirocco";

export interface IHashSource { password: string; }
export interface IHashTarget { hash: string; salt: string; }

const hash = (payload: string): IHashTarget => {
    const salt = crypto.randomBytes(Math.ceil(64 / 2)).toString("hex").slice(0, 64);
    return { salt, hash: crypto.createHmac("sha512", salt).update(payload).digest("hex") };
};

const HashGuard = (object: any): object is IHashSource =>
    "password" in object && typeof object.password === "string";

export const callback = secure<IHashSource, IHashTarget>(HashGuard, (source) =>
    hash(source.password));
```
```typescript
// router.ts
import { Request, Router } from "express";
import { scaffold } from "scirocco";
import { callback, IHashSource, IHashTarget } from "./hash";

interface IHashResponse { hash: string; }

const router: Router = Router();

router.get("/hash", scaffold<IHashSource, IHashTarget, IHashResponse>(
    (req: Request): IHashSource => ({ password: req.query.password }),
    callback,
    (data: IHashTarget, req: Request, res: Response): IHashResponse => ({ hash: data.hash }))); 
```