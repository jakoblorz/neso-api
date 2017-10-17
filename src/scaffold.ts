import { NextFunction, Request, RequestHandler, Response } from "express";

import { Errors } from "./errors";
import { respond } from "./respond";
import { secure } from "./secure";
import { AsyncSyncDestructionMethod, AsyncSyncTransactionMethod, ErrorType } from "./types";

/**
 * check if the given object is a object containing the ErrorType
 * keys with the correct types
 * @param test object to test
 */
export const isErrorType = (test: any) =>
   "status" in test && typeof test.status === "string" &&
   "code" in test && typeof test.code === "number";

/**
 * create a function which invokes a callback and catches all possible errors
 * @param req expressjs request object
 * @param res expressjs response object
 * @param next expressjs next callback
 * @param invokeNextOnError setting if next-callback should be invoked upon error
 * @param passPureErrors setting if error which are not of the type ErrorType
 * should NOT be replaced with a ServerError (500)
 */
export const createExecuteTryCatchEvaluation = (
    req: Request,
    res: Response,
    next: NextFunction,
    invokeNextOnError: boolean,
    passPureErrors: boolean,
) => async <X, Y> (awaitable: AsyncSyncTransactionMethod<X, Y | ErrorType>, arg: X): Promise<Y | null> => {

        // prepare a object which will hold the result of the async callback
        let data: Y | ErrorType =  {} as Y;
        // invoke the callback while catching all possible errors
        try { data = await awaitable(arg); } catch (e) {

            // filter the error by checking if it extends the
            // ErrorType

            // if the error is an error extending the ErrorType
            // and next callback should be invoked
            if (isErrorType(e) && invokeNextOnError) {
                next(e);
                return null;
            }

            // if the error is an error extending the ErrorType
            if (isErrorType(e)) {
                respond(e, res, e.code);
                return null;
            }

            // error e is not extending the ErrorType
            e = { code: Errors.ServerError.code, status: Errors.ServerError.status, error: e };

            // if the error is not an error extending the ErrorType
            // yet the next callback should be invoked
            if (invokeNextOnError) {

                // depending on the setting passPureErrors,
                // replace the error with a ServerError or use the pure on
                next(passPureErrors ? e : Errors.ServerError);
                return null;
            }

            // if the error is not an error extending the ErrorType
            // and the next callback should not be invoked
            respond(passPureErrors ? e : Errors.ServerError, res, Errors.ServerError.code);
            return null;
        }

        // if the result (data) is extending the Error Type, an error
        // occured and the control-flow needs to be altered:
        // here the next callback should be called
        if (isErrorType(data as any) && invokeNextOnError) {
            next(data);
            return null;
        }

        // here the error should be immediately responded
        if (isErrorType(data as any)) {
            respond(data, res, (data as any).code);
            return null;
        }

        // return the data -> return type is Y if the
        // async callback did not return an error in any way
        // return type is null if an error was produced and processed
        return data as Y;
    };

/**
 * prepare (convert) the given object into a sendable response
 * @param obj object to convert
 */
export const prepareSuccessObject = <Type>(obj: Type, successCode: number = 200): ErrorType => {

    // check if the code (http status code) needs to be set
    if ((obj as any).code === undefined || typeof (obj as any).code !== "number") {
        (obj as any).code = successCode;
    }

    // check if the status needs to be set
    if ((obj as any).status === undefined || typeof (obj as any).status !== "string") {
        (obj as any).status = "Success";
    }

    // return the altered object
    return obj as any;
};

/**
 * scaffold a new expressjs request handler which is executing the different evaluation stages
 * automatically
 * @param construct callback which compiles the Request object into a RequestType object
 * @param callback callback which will be executed
 * @param destruct callback which can be set to compile the result into a new object or
 * set custom values on the request object
 * @param invokeNextOnError flag which will change the control flow - instead of immediately
 * responding with and error if one is thrown, invoke the next callback with the error
 * @param passPureErrors flag which will indicate if errors which are not extending the
 * ErrorType should be replaced with a ServerError
 * @param customSuccessCode change the success code which is being sent if the callbacks
 * executed successfully
 */
export const scaffold = <SourceType, TargetType extends ResponseType, ResponseType>(
    construct: AsyncSyncTransactionMethod<Request, SourceType | ErrorType>,
    callback: AsyncSyncTransactionMethod<SourceType, TargetType | ErrorType>,
    destruct: AsyncSyncDestructionMethod<TargetType, ResponseType | ErrorType> =
        (source, req, res) => source,
    invokeNextOnError: boolean = false,
    passPureErrors: boolean = false,
    customSuccessCode: number = 200,
    isMiddlewareCallback: boolean = false,
): RequestHandler => {

    // return an expressjs request handler
    return async (req: Request, res: Response, next: NextFunction) => {

        /**
         * execute the async callback while catching and filtering
         * all possible errors
         * @param awaitable async method which converts type X into
         * type Y or and Error while throwing possibly errors
         * @param arg argument to call the async method with
         */
        const executeTryCatchEvaluation = createExecuteTryCatchEvaluation(
            req, res, next, invokeNextOnError, passPureErrors);

        // execute the construction phase - extract the arguments from the request
        const constructResult = await executeTryCatchEvaluation<Request, SourceType>(construct, req);
        if (constructResult === null) {
            return null;
        }

        // execute the callback phase - process the arguments
        const callbackResult = await executeTryCatchEvaluation<SourceType, TargetType>(callback, constructResult);
        if (callbackResult === null) {
            return null;
        }

        // set the respond object as the callback result
        let response = callbackResult as TargetType | ResponseType | null;

        // execute the destruction phase - reduce the result
        if (destruct !== undefined) {

            // build a callback wrapper to inject the request object as
            // second argument while using executeTryCatchEvaluation method
            const destruction = async (arg: TargetType) =>
                await destruct(arg, req, res);

            // change the response object in the destruction phase
            response = await executeTryCatchEvaluation<TargetType, ResponseType>(destruction, callbackResult);

            // the response can now be null - if the response channel
            // closed already (req.finished) then a error occured
            // -> stop the execution
            if (response === null && res.finished) {
                return null;
            }

            // the response channel was not closed yet thus the response
            // should be the callbackResult
            if (response === null) {
                response = callbackResult;
            }
        }

        // if the call-stack is not a middleware stack,
        // respond with the result
        if (!isMiddlewareCallback) {
            // prepare the body and respond with it using the set status code
            const responseBody = prepareSuccessObject(response);
            respond(responseBody, res, responseBody.code);

            // execution flow of a non-middleware callback ends here
            return null;
        }

        // call-stack is a middleware stack,
        // invoke the next function to proceed with
        // execution of other RequestHandlers
        next();

        // execution flow of a middleware callback ends here
        return null;
    };
};
