#!/usr/bin/env bash

set -e

mkdir -p ./lib

babel src/ -d .
