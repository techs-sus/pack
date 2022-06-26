# pack

Pack is a module bundler which uses inline functions as a means of module loading.

The use of inline functions is due to the speed of loadstring, and in some environments, no loadstring at all.

This module bundler is built for Luau, but it should work on any other environment.
