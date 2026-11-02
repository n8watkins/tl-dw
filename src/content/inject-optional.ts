/**
 * The destination injector (inject.ts) for the optional chat sites: ChatGPT,
 * Claude and NotebookLM. Built as a standalone IIFE and registered at runtime
 * for exactly the sites the user has allowed (see syncInjectorRegistration in
 * the background worker); Gemini's copy is declared in the manifest.
 */
import "./inject";
