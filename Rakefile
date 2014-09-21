require 'jasmine'
require 'coffee-script'
require 'fileutils'
load 'jasmine/tasks/jasmine.rake'

APP_FILE  = 'app.rb'
APP_CLASS = 'App'
require 'sinatra/assetpack/rake'

task 'js_specs' do
  system 'rake assetpack:build'
  system 'rake jasmine:ci'
end
