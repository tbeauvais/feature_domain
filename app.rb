require 'sinatra/base'
require 'sinatra/assetpack'
require 'slim'
require 'coffee-script'
require 'pry'

class App < Sinatra::Base

  set :root, File.dirname(__FILE__) # You must set app root

  register Sinatra::AssetPack

  assets do
    serve '/js',     :from => 'app/js'
    serve '/css',    :from => 'app/css'
    serve '/images', :from => 'app/images'

    js :app, [
        '/js/vendor/angular.js',
        '/js/application.js',
        '/js/vendor/**/*.js',
        '/js/assets/**/*.js',
        '/js/*.js'
    ]

    css :app, [
        '/css/*.css'
    ]

  end

  get '/' do
    slim :index
  end

end




